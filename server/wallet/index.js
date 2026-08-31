/**
 * TeleShort v2.1 — Wallet Overview Endpoint (Phase 7)
 * GET /api/wallet
 * Returns Available Balance, Reserved Balance, and Total Ledger Balance for authenticated user.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Telegram User
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) {
    return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');
  }

  const userId = auth.user.id;

  try {
    const supabase = getSupabaseClient();

    // 2. Fetch User Record
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, balance, total_earned, status')
      .eq('id', userId)
      .single();

    if (userErr || !user) {
      return sendError(res, 'User wallet not found', 404, 'USER_NOT_FOUND');
    }

    // 3. Calculate Reserved Balance from Active Non-Finalized Withdrawals
    // Active states: PENDING, UNDER_REVIEW, APPROVED, PROCESSING
    const { data: activeWithdrawals, error: wErr } = await supabase
      .from('withdrawals')
      .select('amount')
      .eq('user_id', userId)
      .in('status', ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING']);

    if (wErr) throw wErr;

    let reservedBalance = 0.0000;
    (activeWithdrawals || []).forEach(w => {
      reservedBalance += parseFloat(w.amount);
    });

    const availableBalance = parseFloat(user.balance || 0);
    const totalBalance = parseFloat((availableBalance + reservedBalance).toFixed(4));

    // 4. Fetch Minimum Withdrawal Setting
    const { data: configRecord } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'withdrawal_config')
      .single();

    const minThreshold = parseFloat(configRecord?.value?.min_threshold_inr || 100.00);

    return sendSuccess(res, {
      user_id: user.id,
      available_balance: availableBalance,
      reserved_balance: parseFloat(reservedBalance.toFixed(4)),
      total_balance: totalBalance,
      total_earned: parseFloat(user.total_earned || 0),
      currency: 'INR',
      min_withdrawal: minThreshold,
      account_status: user.status
    });
  } catch (error) {
    console.error('[Wallet Overview Error]:', error);
    return sendError(res, error.message || 'Error fetching wallet balances', 500);
  }
};
