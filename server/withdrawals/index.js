/** TeleShort v2.1 — Withdrawals API Endpoint */
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

  try {
    const supabase = getSupabaseClient();
    const { data: user, error: userErr } = await supabase
      .from('users').select('id, balance, status').eq('telegram_id', telegramUserId).maybeSingle();
    if (userErr) throw userErr;
    if (!user) return sendError(res, 'User account not found. Please reopen the Telegram Mini App.', 404, 'USER_NOT_FOUND');
    if (user.status === 'BANNED' || user.status === 'SUSPENDED') return sendError(res, `Account is ${user.status.toLowerCase()}. Withdrawals prohibited.`, 403, 'ACCOUNT_RESTRICTED');

    const userId = user.id;

    if (req.method === 'POST') {
      const rateLimit = await checkRateLimit(`w_req_${telegramUserId}`, 'withdrawal_request', 5, 3600);
      if (!rateLimit.allowed) return sendError(res, 'Too many withdrawal attempts. Please wait an hour.', 429, 'RATE_LIMITED');

      const { amount, payment_method = 'UPI', payout_address, idempotency_key } = req.body || {};
      const parsedAmount = parseFloat(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return sendError(res, 'Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
      if (!payout_address || typeof payout_address !== 'string' || !payout_address.trim()) return sendError(res, 'Payout address / UPI ID is required', 400, 'MISSING_PAYOUT_ADDRESS');

      const { data: configRecord } = await supabase.from('settings').select('min_withdraw').order('id', { ascending: true }).limit(1).maybeSingle();
      const minThreshold = Number(configRecord?.min_withdraw ?? 100);
      if (parsedAmount < minThreshold) return sendError(res, `Minimum withdrawal amount is ₹${minThreshold.toFixed(2)}`, 400, 'MINIMUM_WITHDRAWAL_NOT_MET');

      const availableBalance = Number(user.balance || 0);
      if (parsedAmount > availableBalance) return sendError(res, `Insufficient available balance (Available: ₹${availableBalance.toFixed(2)})`, 400, 'INSUFFICIENT_BALANCE');

      const cooldownHours = 24;
      const cutoff = new Date(Date.now() - cooldownHours * 3600000).toISOString();
      const { count: recentCount } = await supabase.from('withdrawals').select('*', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', cutoff);
      if (recentCount) return sendError(res, `You can only submit one withdrawal request every ${cooldownHours} hours`, 429, 'WITHDRAWAL_COOLDOWN');

      const { data: rpcResult, error: rpcErr } = await supabase.rpc('reserve_withdrawal_balance', {
        p_idempotency_key: idempotency_key || null,
        p_user_id: userId,
        p_amount: parsedAmount,
        p_method: String(payment_method).trim(),
        p_address: String(payout_address).trim()
      });
      if (rpcErr) {
        if (rpcErr.message?.includes('DUPLICATE_WITHDRAWAL')) return sendError(res, 'This withdrawal request has already been submitted', 409, 'WITHDRAWAL_ALREADY_EXISTS');
        if (rpcErr.message?.includes('INSUFFICIENT_BALANCE')) return sendError(res, 'Insufficient available balance', 400, 'INSUFFICIENT_BALANCE');
        throw rpcErr;
      }

      await supabase.from('audit_logs').insert([{ actor_type: 'USER', actor_id: String(telegramUserId), action: 'WITHDRAWAL_CREATED', target_type: 'WITHDRAWAL', target_id: rpcResult.withdrawal_id, metadata: { amount: parsedAmount, method: payment_method, available_balance_after: rpcResult.available_balance } }]);
      return sendSuccess(res, { success: true, withdrawal: { id: rpcResult.withdrawal_id, amount: parsedAmount, currency: 'INR', payment_method, payout_address, status: 'PENDING', available_balance: rpcResult.available_balance }, message: 'Withdrawal request submitted successfully and funds reserved for review.' }, 201);
    }

    if (req.method === 'GET') {
      const page = Math.max(1, parseInt(req.query?.page || '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;
      const { data: withdrawals, error, count } = await supabase.from('withdrawals').select('id, amount, payment_method, payout_address, status, admin_notes, created_at, processed_at', { count: 'exact' }).eq('user_id', userId).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      return sendSuccess(res, { withdrawals: (withdrawals || []).map(w => ({ ...w, amount: Number(w.amount), currency: 'INR' })), pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) } });
    }

    return sendError(res, 'Method Not Allowed', 405);
  } catch (error) {
    console.error('[Withdrawals Error]:', error);
    return sendError(res, error.message || 'Error processing withdrawal', 500, 'WITHDRAWAL_ERROR');
  }
};