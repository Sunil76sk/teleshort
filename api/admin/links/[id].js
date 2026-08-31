/**
 * TeleShort v2.1 — Admin Link Status Management Endpoint (Phase 8)
 * POST /api/admin/links/[id] — Update link status (ACTIVE, DISABLED, FLAGGED) with audit logging
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const linkId = req.query?.id;
  if (!linkId) {
    return sendError(res, 'Link ID is required', 400, 'MISSING_LINK_ID');
  }

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin (SUPER_ADMIN or SUPPORT_ADMIN)
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'SUPPORT_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
  }

  const { status, reason } = req.body || {};
  const allowedStatuses = new Set(['ACTIVE', 'DISABLED', 'FLAGGED']);

  if (!status || !allowedStatuses.has(status.toUpperCase())) {
    return sendError(res, 'Invalid status. Must be ACTIVE, DISABLED, or FLAGGED.', 400, 'INVALID_STATUS');
  }

  const newStatus = status.toUpperCase();

  try {
    const supabase = getSupabaseClient();

    // 2. Fetch current link
    const { data: link, error: fetchErr } = await supabase
      .from('links')
      .select('id, short_code, status, owner_id')
      .eq('id', linkId)
      .single();

    if (fetchErr || !link) {
      return sendError(res, 'Link not found', 404, 'NOT_FOUND');
    }

    const previousStatus = link.status;

    // 3. Update link status
    const { data: updatedLink, error: updateErr } = await supabase
      .from('links')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', linkId)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // 4. Log Admin Audit Record
    await supabase.from('audit_logs').insert([
      {
        actor_type: 'ADMIN',
        actor_id: auth.admin.userId || auth.admin.username || 'ADMIN',
        action: `LINK_STATUS_${newStatus}`,
        target_type: 'LINK',
        target_id: linkId,
        metadata: {
          short_code: link.short_code,
          previous_status: previousStatus,
          new_status: newStatus,
          reason: reason || 'Admin action'
        }
      }
    ]);

    return sendSuccess(res, {
      link: updatedLink,
      message: `Link ${link.short_code} status updated to ${newStatus}`
    });
  } catch (error) {
    console.error('[Admin Update Link Status Error]:', error);
    return sendError(res, error.message || 'Error updating link status', 500);
  }
};
