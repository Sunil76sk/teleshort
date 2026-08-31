/**
 * TeleShort v2.1 — Admin Fraud Events Endpoint (Phase 8)
 * GET /api/admin/fraud
 * Lists suspicious events and fraud score adjustments.
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
  }

  try {
    const supabase = getSupabaseClient();
    const page = Math.max(1, parseInt(req.query?.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const { data: fraudEvents, error, count } = await supabase
      .from('fraud_events')
      .select('id, user_id, event_type, score_delta, metadata, created_at, users(username, first_name, status)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formatted = (fraudEvents || []).map(fe => ({
      id: fe.id,
      user_id: fe.user_id,
      username: fe.users?.username || null,
      first_name: fe.users?.first_name || 'User',
      user_status: fe.users?.status || 'ACTIVE',
      event_type: fe.event_type,
      score_delta: fe.score_delta,
      metadata: fe.metadata,
      created_at: fe.created_at
    }));

    return sendSuccess(res, {
      fraud_events: formatted,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('[Admin List Fraud Events Error]:', error);
    return sendError(res, error.message || 'Error fetching fraud events', 500);
  }
};
