/**
 * TeleShort v2.1 — Wallet Transactions Ledger History Endpoint (Phase 7)
 * GET /api/wallet/transactions
 * Returns immutable paginated ledger records for the authenticated user.
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
    const page = Math.max(1, parseInt(req.query?.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
    const offset = (page - 1) * limit;

    // 2. Fetch User's Immutable Ledger Transactions (Anti-IDOR)
    const { data: transactions, error, count } = await supabase
      .from('wallet_transactions')
      .select('id, type, amount, currency, reference_type, reference_id, balance_before, balance_after, status, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // 3. Format Transaction Items with UI-Friendly Details
    const formatted = (transactions || []).map(tx => {
      const isPositive = parseFloat(tx.amount) >= 0;
      let label = 'Transaction';
      if (tx.type === 'AD_REWARD') label = 'Ad Reward';
      else if (tx.type === 'REFERRAL_REWARD') label = 'Referral Commission';
      else if (tx.type === 'WITHDRAWAL_RESERVE') label = 'Withdrawal Reserved';
      else if (tx.type === 'WITHDRAWAL_REFUND') label = 'Withdrawal Refunded';
      else if (tx.type === 'ADMIN_ADJUSTMENT') label = 'Admin Adjustment';
      else if (tx.type === 'BONUS') label = 'Bonus Credit';

      return {
        id: tx.id,
        type: tx.type,
        label,
        amount: parseFloat(tx.amount),
        is_credit: isPositive,
        currency: tx.currency || 'INR',
        balance_after: parseFloat(tx.balance_after),
        status: tx.status,
        created_at: tx.created_at
      };
    });

    return sendSuccess(res, {
      transactions: formatted,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('[Wallet Transactions Error]:', error);
    return sendError(res, error.message || 'Error fetching transactions', 500);
  }
};
