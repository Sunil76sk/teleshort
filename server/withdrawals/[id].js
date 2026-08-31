/**
 * TeleShort v2.1 — Single Withdrawal Details Endpoint (Phase 7)
 * GET /api/withdrawals/[id]
 * Retrieves single withdrawal details for the authenticated user (Anti-IDOR).
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
  const withdrawalId = req.query?.id;

  if (!withdrawalId) {
    return sendError(res, 'Withdrawal ID is required', 400, 'MISSING_WITHDRAWAL_ID');
  }

  try {
    const supabase = getSupabaseClient();

    // 2. Fetch Withdrawal Record (Strict Ownership Scope)
    const { data: withdrawal, error } = await supabase
      .from('withdrawals')
      .select('id, amount, payment_method, payout_address, status, admin_notes, created_at, processed_at')
      .eq('id', withdrawalId)
      .eq('user_id', userId) // Anti-IDOR: only user's own withdrawal
      .single();

    if (error || !withdrawal) {
      return sendError(res, 'Withdrawal not found or access denied', 404, 'NOT_FOUND');
    }

    return sendSuccess(res, {
      withdrawal: {
        id: withdrawal.id,
        amount: parseFloat(withdrawal.amount),
        currency: 'INR',
        payment_method: withdrawal.payment_method,
        payout_address: withdrawal.payout_address,
        status: withdrawal.status,
        admin_notes: withdrawal.admin_notes,
        created_at: withdrawal.created_at,
        processed_at: withdrawal.processed_at
      }
    });
  } catch (error) {
    console.error('[Withdrawal Detail Error]:', error);
    return sendError(res, error.message || 'Error fetching withdrawal details', 500);
  }
};
