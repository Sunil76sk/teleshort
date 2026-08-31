/**
 * TeleShort v2.1 — Admin Audit Logs List Endpoint (Phase 8)
 * GET /api/admin/audit-logs
 * Retrieves immutable audit records with filtering by actor, action, target, and date range.
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin (SUPER_ADMIN and SUPPORT_ADMIN)
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'SUPPORT_ADMIN', 'FINANCE_ADMIN', 'ANALYTICS_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
  }

  try {
    const supabase = getSupabaseClient();
    const actionFilter = req.query?.action;
    const actorFilter = req.query?.actor_id;
    const page = Math.max(1, parseInt(req.query?.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('audit_logs')
      .select('id, actor_type, actor_id, action, target_type, target_id, metadata, created_at', { count: 'exact' });

    if (actionFilter && typeof actionFilter === 'string') {
      query = query.ilike('action', `%${actionFilter.trim()}%`);
    }

    if (actorFilter && typeof actorFilter === 'string') {
      query = query.eq('actor_id', actorFilter.trim());
    }

    const { data: logs, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return sendSuccess(res, {
      audit_logs: logs || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('[Admin List Audit Logs Error]:', error);
    return sendError(res, error.message || 'Error fetching audit logs', 500);
  }
};
