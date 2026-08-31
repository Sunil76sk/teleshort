/**
 * TeleShort v2.1 — Withdrawals API Endpoint (Phase 7)
 * POST /api/withdrawals — Submit new withdrawal request with atomic balance reservation
 * GET /api/withdrawals — List authenticated user's withdrawal requests
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // 1. Authenticate Telegram User
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) {
    return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');
  }

  const userId = auth.user.id;

  // =========================================================================
  // POST /api/withdrawals — Request Withdrawal
  // =========================================================================
  if (req.method === 'POST') {
    // Sliding Window Rate Limit: Max 5 withdrawal attempts per hour per user
    const rateLimit = await checkRateLimit(`w_req_${userId}`, 'withdrawal_request', 5, 3600);
    if (!rateLimit.allowed) {
      return sendError(res, 'Too many withdrawal attempts. Please wait an hour.', 429, 'RATE_LIMITED');
    }

    const {
      amount,
      payment_method = 'UPI',
      payout_address,
      idempotency_key
    } = req.body || {};

    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount <= 0) {
      return sendError(res, 'Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
    }

    if (!payout_address || typeof payout_address !== 'string' || payout_address.trim().length === 0) {
      return sendError(res, 'Payout address / UPI ID is required', 400, 'MISSING_PAYOUT_ADDRESS');
    }

    try {
      const supabase = getSupabaseClient();

      // 2. Fetch User Record
      const { data: user, error: userErr } = await supabase
        .from('users')
        .select('id, balance, status')
        .eq('id', userId)
        .single();

      if (userErr || !user) {
        return sendError(res, 'User account not found', 404, 'USER_NOT_FOUND');
      }

      if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
        return sendError(res, `Account is ${user.status.toLowerCase()}. Withdrawals prohibited.`, 403, 'ACCOUNT_RESTRICTED');
      }

      // 3. Fetch Minimum Withdrawal Setting
      const { data: configRecord } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'withdrawal_config')
        .single();

      const config = configRecord?.value || {};
      const minThreshold = parseFloat(config.min_threshold_inr || 100.00);

      if (parsedAmount < minThreshold) {
        return sendError(res, `Minimum withdrawal amount is ₹${minThreshold.toFixed(2)}`, 400, 'MINIMUM_WITHDRAWAL_NOT_MET');
      }

      const availableBalance = parseFloat(user.balance || 0);
      if (parsedAmount > availableBalance) {
        return sendError(res, `Insufficient available balance (Available: ₹${availableBalance.toFixed(2)})`, 400, 'INSUFFICIENT_BALANCE');
      }

      // 4. Cooldown Check (e.g. 24-hour frequency protection)
      const cooldownHours = parseInt(config.cooldown_hours, 10) || 24;
      const cooldownCutoff = new Date(Date.now() - (cooldownHours * 60 * 60 * 1000)).toISOString();

      const { count: recentCount } = await supabase
        .from('withdrawals')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', cooldownCutoff);

      if (recentCount && recentCount > 0) {
        return sendError(res, `You can only submit one withdrawal request every ${cooldownHours} hours`, 429, 'WITHDRAWAL_COOLDOWN');
      }

      // 5. Execute Atomic Database Balance Reservation (SECURITY DEFINER)
      const validIdempotencyKey = idempotency_key || null;
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('reserve_withdrawal_balance', {
        p_idempotency_key: validIdempotencyKey,
        p_user_id: userId,
        p_amount: parsedAmount,
        p_method: String(payment_method).trim(),
        p_address: String(payout_address).trim()
      });

      if (rpcErr) {
        if (rpcErr.message && rpcErr.message.includes('DUPLICATE_WITHDRAWAL')) {
          return sendError(res, 'This withdrawal request has already been submitted', 409, 'WITHDRAWAL_ALREADY_EXISTS');
        }
        if (rpcErr.message && rpcErr.message.includes('INSUFFICIENT_BALANCE')) {
          return sendError(res, 'Insufficient available balance', 400, 'INSUFFICIENT_BALANCE');
        }
        throw rpcErr;
      }

      // 6. Log Audit Event
      await supabase.from('audit_logs').insert([
        {
          actor_type: 'USER',
          actor_id: String(userId),
          action: 'WITHDRAWAL_CREATED',
          target_type: 'WITHDRAWAL',
          target_id: rpcResult.withdrawal_id,
          metadata: {
            amount: parsedAmount,
            method: payment_method,
            available_balance_after: rpcResult.available_balance
          }
        }
      ]);

      return sendSuccess(res, {
        success: true,
        withdrawal: {
          id: rpcResult.withdrawal_id,
          amount: parsedAmount,
          currency: 'INR',
          payment_method: payment_method,
          payout_address: payout_address,
          status: 'PENDING',
          available_balance: rpcResult.available_balance
        },
        message: 'Withdrawal request submitted successfully and funds reserved for review.'
      }, 201);
    } catch (error) {
      console.error('[Create Withdrawal Error]:', error);
      return sendError(res, error.message || 'Error processing withdrawal', 500);
    }
  }

  // =========================================================================
  // GET /api/withdrawals — List User's Withdrawals (Anti-IDOR)
  // =========================================================================
  if (req.method === 'GET') {
    try {
      const supabase = getSupabaseClient();
      const page = Math.max(1, parseInt(req.query?.page || '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const { data: withdrawals, error, count } = await supabase
        .from('withdrawals')
        .select('id, amount, payment_method, payout_address, status, admin_notes, created_at, processed_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return sendSuccess(res, {
        withdrawals: (withdrawals || []).map(w => ({
          id: w.id,
          amount: parseFloat(w.amount),
          currency: 'INR',
          payment_method: w.payment_method,
          payout_address: w.payout_address,
          status: w.status,
          admin_notes: w.admin_notes,
          created_at: w.created_at,
          processed_at: w.processed_at
        })),
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });
    } catch (error) {
      console.error('[List Withdrawals Error]:', error);
      return sendError(res, error.message || 'Error fetching withdrawals', 500);
    }
  }

  return sendError(res, 'Method Not Allowed', 405);
};
