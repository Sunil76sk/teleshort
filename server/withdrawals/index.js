/** TeleShort v2.2 — Withdrawals API */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');
  const telegramUserId = Number(auth.user.id);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return sendError(res, 'Invalid Telegram user ID', 400, 'INVALID_TELEGRAM_USER');
  if (!process.env.CHALLENGE_SECRET || process.env.CHALLENGE_SECRET.length < 16) return sendError(res, 'Server financial security is not configured', 503, 'SERVER_CONFIG_ERROR');

  try {
    const supabase = getSupabaseClient();
    const { data: user, error: userErr } = await supabase.from('users').select('id,balance,status,username').eq('telegram_id', telegramUserId).maybeSingle();
    if (userErr) throw userErr;
    if (!user) return sendError(res, 'User account not found. Please reopen the Telegram Mini App.', 404, 'USER_NOT_FOUND');
    if (['BANNED', 'SUSPENDED'].includes(String(user.status).toUpperCase())) return sendError(res, `Account is ${String(user.status).toLowerCase()}. Withdrawals prohibited.`, 403, 'ACCOUNT_RESTRICTED');

    if (req.method === 'POST') {
      const rateLimit = await checkRateLimit(`w_req_${telegramUserId}`, 'withdrawal_request', 5, 3600);
      if (!rateLimit.allowed) return sendError(res, 'Too many withdrawal attempts. Please wait an hour.', 429, 'RATE_LIMITED');
      const { amount, payment_method = 'UPI', payout_address, idempotency_key } = req.body || {};
      const parsedAmount = Number(amount);
      const method = String(payment_method).trim().toUpperCase();
      const allowedMethods = new Set(['UPI', 'BINANCE PAY', 'USDT TRC20', 'PAYPAL']);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return sendError(res, 'Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
      if (!allowedMethods.has(method)) return sendError(res, 'Unsupported payment method', 400, 'INVALID_PAYMENT_METHOD');
      if (!payout_address || typeof payout_address !== 'string' || payout_address.trim().length < 3 || payout_address.trim().length > 256) return sendError(res, 'Payout address / UPI ID is required', 400, 'MISSING_PAYOUT_ADDRESS');

      const { data: configRow } = await supabase.from('settings').select('value').eq('key', 'withdrawal_config').maybeSingle();
      const legacy = await supabase.from('settings').select('min_withdraw').is('key', null).limit(1).maybeSingle();
      const minThreshold = Number(configRow?.value?.min_threshold_inr ?? legacy.data?.min_withdraw ?? 100);
      if (!Number.isFinite(minThreshold) || minThreshold < 1) return sendError(res, 'Withdrawal configuration is invalid', 503, 'CONFIG_ERROR');
      if (parsedAmount < minThreshold) return sendError(res, `Minimum withdrawal amount is ₹${minThreshold.toFixed(2)}`, 400, 'MINIMUM_WITHDRAWAL_NOT_MET');

      const recentCutoff = new Date(Date.now() - 24 * 3600000).toISOString();
      const { count: recentCount, error: recentErr } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', recentCutoff).not('status', 'in', '(REJECTED,CANCELLED)');
      if (recentErr) throw recentErr;
      if (recentCount) return sendError(res, 'You can only submit one withdrawal request every 24 hours', 429, 'WITHDRAWAL_COOLDOWN');

      const key = idempotency_key && String(idempotency_key).length <= 128 ? String(idempotency_key) : null;
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('reserve_withdrawal_balance', {
        p_idempotency_key: key,
        p_user_id: user.id,
        p_amount: parsedAmount,
        p_method: method,
        p_address: payout_address.trim(),
        p_server_secret: process.env.CHALLENGE_SECRET
      });
      if (rpcErr) {
        const msg = String(rpcErr.message || '');
        if (msg.includes('DUPLICATE_WITHDRAWAL')) return sendError(res, 'This withdrawal request has already been submitted', 409, 'WITHDRAWAL_ALREADY_EXISTS');
        if (msg.includes('INSUFFICIENT_BALANCE')) return sendError(res, 'Insufficient available balance', 400, 'INSUFFICIENT_BALANCE');
        throw rpcErr;
      }

      await supabase.from('audit_logs').insert([{
        actor_type: 'USER', actor_id: String(telegramUserId), action: 'WITHDRAWAL_CREATED', target_type: 'WITHDRAWAL', target_id: rpcResult.withdrawal_id,
        metadata: { amount: parsedAmount, method, available_balance_after: rpcResult.available_balance }
      }]);
      return sendSuccess(res, { withdrawal: { id: rpcResult.withdrawal_id, amount: parsedAmount, currency: 'INR', payment_method: method, payout_address: payout_address.trim(), status: 'PENDING', available_balance: rpcResult.available_balance }, message: 'Withdrawal request submitted successfully and funds reserved for review.' }, 201);
    }

    if (req.method === 'GET') {
      const page = Math.max(1, parseInt(req.query?.page || '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;
      const { data: withdrawals, error, count } = await supabase.from('withdrawals').select('id,amount,payment_method,payout_address,method,details,status,admin_notes,created_at,processed_at', { count: 'exact' }).eq('user_id', user.id).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      return sendSuccess(res, {
        withdrawals: (withdrawals || []).map(w => ({ id: w.id, amount: Number(w.amount), currency: 'INR', payment_method: w.payment_method || w.method, payout_address: w.payout_address || w.details, status: w.status, admin_notes: w.admin_notes, created_at: w.created_at, processed_at: w.processed_at })),
        pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) }
      });
    }
    return sendError(res, 'Method Not Allowed', 405);
  } catch (error) {
    console.error('[Withdrawals Error]:', error);
    return sendError(res, error.message || 'Error processing withdrawal', 500, 'WITHDRAWAL_ERROR');
  }
};
