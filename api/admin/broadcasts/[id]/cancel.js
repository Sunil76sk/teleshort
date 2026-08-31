/**
 * TeleShort v2.1 — Admin Cancel Broadcast Endpoint (Phase 8)
 * POST /api/admin/broadcasts/[id]/cancel
 * Cancels a pending broadcast.
 */

const { handleCors, sendSuccess, sendError } = require('../../../utils/response');
const { authenticateAdmin } = require('../../../utils/auth');
const { getSupabaseClient } = require('../../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'MARKETING_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
  }

  const broadcastId = req.query?.id;
  if (!broadcastId) {
    return sendError(res, 'Broadcast ID is required', 400, 'MISSING_BROADCAST_ID');
  }

  try {
    const supabase = getSupabaseClient();

    const { data: broadcast, error: fetchErr } = await supabase
      .from('broadcasts')
      .select('id, status')
      .eq('id', broadcastId)
      .single();

    if (fetchErr || !broadcast) {
      return sendError(res, 'Broadcast not found', 404, 'NOT_FOUND');
    }

    if (broadcast.status !== 'PENDING') {
      return sendError(res, `Cannot cancel broadcast with status "${broadcast.status}"`, 400, 'CANNOT_CANCEL');
    }

    const { data: updated, error: updateErr } = await supabase
      .from('broadcasts')
      .update({ status: 'FAILED', completed_at: new Date().toISOString() })
      .eq('id', broadcastId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // Audit Log
    await supabase.from('audit_logs').insert([
      {
        actor_type: 'ADMIN',
        actor_id: auth.admin.userId || auth.admin.username || 'ADMIN',
        action: 'BROADCAST_CANCELLED',
        target_type: 'BROADCAST',
        target_id: broadcastId,
        metadata: { status: 'CANCELLED' }
      }
    ]);

    return sendSuccess(res, {
      broadcast: updated,
      message: 'Broadcast cancelled successfully'
    });
  } catch (error) {
    console.error('[Admin Cancel Broadcast Error]:', error);
    return sendError(res, error.message || 'Error cancelling broadcast', 500);
  }
};
