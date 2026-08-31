/**
 * TeleShort v2.1 — Admin Users List Endpoint (Phase 8)
 * GET /api/admin/users
 * Search and filter users with pagination (safe data exposure).
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
      .from('users')
      .select('id, username, first_name, balance, total_earned, referred_by, status, created_at, last_seen_at', { count: 'exact' });

    if (statusFilter && typeof statusFilter === 'string') {
      query = query.eq('status', statusFilter.toUpperCase());
    }

    if (querySearch && typeof querySearch === 'string') {
      const trimmed = querySearch.trim();
      if (!isNaN(parseInt(trimmed, 10))) {
        query = query.eq('id', parseInt(trimmed, 10));
      } else {
        query = query.ilike('username', `%${trimmed}%`);
      }
    }

    const { data: users, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formatted = (users || []).map(u => ({
      id: u.id,
      username: u.username,
      first_name: u.first_name,
      available_balance: parseFloat(u.balance || 0),
      total_earned: parseFloat(u.total_earned || 0),
      referred_by: u.referred_by,
      status: u.status,
      created_at: u.created_at,
      last_seen_at: u.last_seen_at
    }));

    return sendSuccess(res, {
      users: formatted,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('[Admin List Users Error]:', error);
    return sendError(res, error.message || 'Error fetching users', 500);
  }
};
