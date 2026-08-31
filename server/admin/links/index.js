/**
 * TeleShort v2.1 — Admin Links Management Endpoint (Phase 8)
 * GET /api/admin/links
 * Search and filter links with pagination.
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
    const querySearch = req.query?.q;
    const statusFilter = req.query?.status;
    const page = Math.max(1, parseInt(req.query?.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('links')
      .select('id, short_code, owner_id, original_url, status, click_count, eligible_click_count, total_earnings, created_at', { count: 'exact' });

    if (statusFilter && typeof statusFilter === 'string') {
      query = query.eq('status', statusFilter.toUpperCase());
    }

    if (querySearch && typeof querySearch === 'string') {
      const trimmed = querySearch.trim();
      query = query.or(`short_code.ilike.%${trimmed}%,original_url.ilike.%${trimmed}%`);
    }

    const { data: links, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return sendSuccess(res, {
      links: (links || []).map(l => ({
        id: l.id,
        short_code: l.short_code,
        owner_id: l.owner_id,
        original_url: l.original_url,
        status: l.status,
        click_count: l.click_count || 0,
        eligible_click_count: l.eligible_click_count || 0,
        total_earnings: parseFloat(l.total_earnings || 0),
        created_at: l.created_at
      })),
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('[Admin List Links Error]:', error);
    return sendError(res, error.message || 'Error fetching links', 500);
  }
};
