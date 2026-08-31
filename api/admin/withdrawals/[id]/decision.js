/**
 * TeleShort v2.1 — Admin Withdrawal Decision Endpoint (Phase 7)
 * POST /api/admin/withdrawals/[id]/decision
 * Executes state transitions: UNDER_REVIEW, APPROVED, PROCESSING, PAID, REJECTED (with atomic refund)
 * Gated by strict RBAC (SUPER_ADMIN and FINANCE_ADMIN only).
 */

const { handleCors, sendSuccess, sendError } = require('../../../utils/response');
const { authenticateAdmin } = require('../../../utils/auth');
const { getSupabaseClient } = require('../../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin with Strict RBAC (Only SUPER_ADMIN & FINANCE_ADMIN can make financial decisions)
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'FINANCE_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Financial admin authorization required', 403, 'FORBIDDEN');
  }

  const adminId = auth.admin.userId || auth.admin.username || 'ADMIN';
  const withdrawalId = req.query?.id;

  if (!withdrawalId) {
    return sendError(res, 'Withdrawal ID is required', 400, 'MISSING_WITHDRAWAL_ID');
  }

  const { status, admin_notes, payout_tx_id } = req.body || {};

  const allowedStatuses = new Set(['UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED']);
  if (!status || !allowedStatuses.has(status.toUpperCase())) {
    return sendError(res, 'Invalid withdrawal status decision', 400, 'INVALID_STATUS');
  }

  const normalizedStatus = status.toUpperCase();

  try {
    const supabase = getSupabaseClient();

    // 2. Execute Atomic Decision Procedure in Database
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('process_withdrawal_decision', {
      p_withdrawal_id: withdrawalId,
      p_new_status: normalizedStatus,
      p_admin_id: String(adminId),
      p_admin_notes: admin_notes ? String(admin_notes).trim() : null,
      p_payout_tx_id: payout_tx_id ? String(payout_tx_id).trim() : null
    });

    if (rpcErr) {
      if (rpcErr.message && rpcErr.message.includes('WITHDRAWAL_NOT_FOUND')) {
        return sendError(res, 'Withdrawal not found', 404, 'NOT_FOUND');
      }
      if (rpcErr.message && rpcErr.message.includes('ALREADY_PAID')) {
        return sendError(res, 'Withdrawal has already been marked as PAID', 409, 'ALREADY_PAID');
      }
      if (rpcErr.message && rpcErr.message.includes('ALREADY_REJECTED')) {
        return sendError(res, 'Withdrawal has already been rejected and refunded', 409, 'ALREADY_REJECTED');
      }
      throw rpcErr;
    }

    return sendSuccess(res, {
      success: true,
      withdrawal_id: withdrawalId,
      status: normalizedStatus,
      message: `Withdrawal status successfully updated to ${normalizedStatus}`
    });
  } catch (error) {
    console.error('[Admin Withdrawal Decision Error]:', error);
    return sendError(res, error.message || 'Error processing withdrawal decision', 500);
  }
};
