/**
 * TeleShort v2.1 — Admin Withdrawals List Endpoint (Phase 7)
 * GET /api/admin/withdrawals
 * Retrieves withdrawal requests for admin review with filtering and RBAC authorization.
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin with RBAC (All admin roles can view)
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
  }

  try {
    const supabase = getSupabaseClient();
    const statusFilter = req.query?.status;
    const page = Math.max(1, parseInt(req.query?.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('withdrawals')
      .select('id, user_id, amount, payment_method, payout_address, status, admin_notes, created_at, processed_at, users(first_name, username, balance)', { count: 'exact' });

    if (statusFilter && typeof statusFilter === 'string') {
      query = query.eq('status', statusFilter.toUpperCase());
    }

    const { data: withdrawals, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const formatted = (withdrawals || []).map(w => ({
      id: w.id,
      user_id: w.user_id,
      user_name: w.users?.first_name || 'User',
      username: w.users?.username || null,
      user_available_balance: parseFloat(w.users?.balance || 0),
      amount: parseFloat(w.amount),
      currency: 'INR',
      payment_method: w.payment_method,
      payout_address: w.payout_address,
      status: w.status,
      admin_notes: w.admin_notes,
      created_at: w.created_at,
      processed_at: w.processed_at
    }));

    return sendSuccess(res, {
      withdrawals: formatted,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error('[Admin List Withdrawals Error]:', error);
    return sendError(res, error.message || 'Error fetching withdrawals', 500);
  }
};
