/** TeleShort v2.1 — Wallet Overview Endpoint */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return sendError(res, 'Method Not Allowed', 405);

  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');

  const telegramUserId = Number(auth.user.id);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return sendError(res, 'Invalid Telegram user ID', 400, 'INVALID_TELEGRAM_USER');

  try {
    const supabase = getSupabaseClient();
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, telegram_id, balance, total_earned, status')
      .eq('telegram_id', telegramUserId)
      .maybeSingle();
    if (userErr) throw userErr;
    if (!user) return sendError(res, 'User wallet not found. Please reopen the Telegram Mini App.', 404, 'USER_NOT_FOUND');

    const { data: activeWithdrawals, error: wErr } = await supabase
      .from('withdrawals').select('amount')
      .eq('user_id', user.id)
      .in('status', ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING']);
    if (wErr) throw wErr;

    let reservedBalance = 0;
    (activeWithdrawals || []).forEach(w => { reservedBalance += Number(w.amount || 0); });
    const availableBalance = Number(user.balance || 0);
    const totalBalance = Number((availableBalance + reservedBalance).toFixed(4));

    // Current production schema stores withdrawal minimum directly on settings.min_withdraw.
    const { data: configRecord } = await supabase.from('settings').select('min_withdraw').order('id', { ascending: true }).limit(1).maybeSingle();
    const minThreshold = Number(configRecord?.min_withdraw ?? 100);

    return sendSuccess(res, {
      user_id: user.id,
      available_balance: availableBalance,
      reserved_balance: Number(reservedBalance.toFixed(4)),
      total_balance: totalBalance,
      total_earned: Number(user.total_earned || 0),
      currency: 'INR',
      min_withdrawal: minThreshold,
      account_status: user.status
    });
  } catch (error) {
    console.error('[Wallet Overview Error]:', error);
    return sendError(res, error.message || 'Error fetching wallet balances', 500, 'WALLET_ERROR');
  }
};