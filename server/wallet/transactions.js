/**
 * TeleShort v2.1 — Wallet Transactions Ledger History Endpoint
 * GET /api/wallet/transactions
 */
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
    const { data: user, error: userErr } = await supabase.from('users').select('id').eq('telegram_id', telegramUserId).maybeSingle();
    if (userErr) throw userErr;
    if (!user) return sendError(res, 'User account not found. Please reopen the Telegram Mini App.', 404, 'USER_NOT_FOUND');

    const page = Math.max(1, parseInt(req.query?.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '50', 10)));
    const offset = (page - 1) * limit;
    const { data: transactions, error, count } = await supabase
      .from('wallet_transactions')
      .select('id,type,amount,currency,reference_type,reference_id,balance_before,balance_after,status,created_at', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const formatted = (transactions || []).map(tx => {
      const amount = Number(tx.amount || 0);
      const isCredit = amount >= 0;
      const labels = {
        AD_REWARD: 'Ad Reward',
        REFERRAL_REWARD: 'Referral Commission',
        WITHDRAWAL_RESERVE: 'Withdrawal Reserved',
        WITHDRAWAL_REFUND: 'Withdrawal Refunded',
        ADMIN_ADJUSTMENT: 'Admin Adjustment',
        BONUS: 'Bonus Credit',
        REVERSAL: 'Reversal'
      };
      return {
        id: tx.id,
        type: tx.type,
        label: labels[tx.type] || 'Transaction',
        amount,
        is_credit: isCredit,
        currency: tx.currency || 'INR',
        reference_type: tx.reference_type,
        reference_id: tx.reference_id,
        balance_before: Number(tx.balance_before || 0),
        balance_after: Number(tx.balance_after || 0),
        status: tx.status,
        created_at: tx.created_at
      };
    });

    return sendSuccess(res, {
      transactions: formatted,
      pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) }
    });
  } catch (error) {
    console.error('[Wallet Transactions Error]:', error);
    return sendError(res, error.message || 'Error fetching transactions', 500, 'WALLET_TRANSACTIONS_ERROR');
  }
};
