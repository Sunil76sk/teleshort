/**
 * TeleShort v2.1 — Admin User Detail & Status Management Endpoint (Phase 8)
 * GET /api/admin/users/[id] — Full profile inspection
 * POST /api/admin/users/[id] — Change user status (BAN, SUSPEND, ACTIVE) with audit logging
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const userId = req.query?.id;
  if (!userId) {
    return sendError(res, 'User ID is required', 400, 'MISSING_USER_ID');
  }

  // =========================================================================
  // GET /api/admin/users/[id] — View Full User Details
  // =========================================================================
  if (req.method === 'GET') {
    const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
    if (!auth.authenticated || !auth.admin) {
      return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
    }

    try {
      const supabase = getSupabaseClient();

      const { data: user, error: userErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userErr || !user) {
        return sendError(res, 'User not found', 404, 'NOT_FOUND');
      }

      // Aggregate Links, Referrals, Withdrawals
      const { count: linksCount } = await supabase.from('links').select('*', { count: 'exact', head: true }).eq('owner_id', userId);
      const { count: referralsCount } = await supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_id', userId);
      const { data: withdrawals } = await supabase.from('withdrawals').select('amount, status').eq('user_id', userId);
      const { data: fraudEvents } = await supabase.from('fraud_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);

      let totalWithdrawn = 0.00;
      (withdrawals || []).forEach(w => {
        if (w.status === 'PAID') totalWithdrawn += parseFloat(w.amount);
      });

      return sendSuccess(res, {
        user: {
          id: user.id,
          username: user.username,
          first_name: user.first_name,
          available_balance: parseFloat(user.balance || 0),
          total_earned: parseFloat(user.total_earned || 0),
          total_withdrawn: parseFloat(totalWithdrawn.toFixed(2)),
          referred_by: user.referred_by,
          status: user.status,
          created_at: user.created_at,
          last_seen_at: user.last_seen_at
        },
        stats: {
          links_count: linksCount || 0,
          referrals_count: referralsCount || 0,
          fraud_events_count: fraudEvents?.length || 0
        },
        recent_fraud_events: fraudEvents || []
      });
    } catch (error) {
      console.error('[Admin User Detail Error]:', error);
      return sendError(res, error.message || 'Error fetching user details', 500);
    }
  }

  // =========================================================================
  // POST /api/admin/users/[id] — Update User Status (BAN / SUSPEND / ACTIVE)
  // =========================================================================
  if (req.method === 'POST') {
    const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'SUPPORT_ADMIN']);
    if (!auth.authenticated || !auth.admin) {
      return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
    }

    const { action, reason } = req.body || {};
    const allowedActions = new Set(['BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND']);

    if (!action || !allowedActions.has(action.toUpperCase())) {
      return sendError(res, 'Invalid action. Must be BAN, UNBAN, SUSPEND, or UNSUSPEND.', 400, 'INVALID_ACTION');
    }

    if ((action.toUpperCase() === 'BAN' || action.toUpperCase() === 'SUSPEND') && (!reason || reason.trim().length === 0)) {
      return sendError(res, 'A clear reason is required when banning or suspending a user.', 400, 'REASON_REQUIRED');
    }

    let newStatus = 'ACTIVE';
    if (action.toUpperCase() === 'BAN') newStatus = 'BANNED';
    if (action.toUpperCase() === 'SUSPEND') newStatus = 'SUSPENDED';

    try {
      const supabase = getSupabaseClient();

      const { data: user, error: updateErr } = await supabase
        .from('users')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('id, username, status')
        .single();

      if (updateErr || !user) {
        return sendError(res, 'Failed to update user status', 500);
      }

      // Log Admin Audit Record
      await supabase.from('audit_logs').insert([
        {
          actor_type: 'ADMIN',
          actor_id: auth.admin.userId || auth.admin.username || 'ADMIN',
          action: `USER_${action.toUpperCase()}`,
          target_type: 'USER',
          target_id: String(userId),
          metadata: {
            previous_action: action,
            new_status: newStatus,
            reason: reason || 'Admin action'
          }
        }
      ]);

      return sendSuccess(res, {
        user,
        message: `User ${userId} status updated to ${newStatus}`
      });
    } catch (error) {
      console.error('[Admin Update User Status Error]:', error);
      return sendError(res, error.message || 'Error updating user status', 500);
    }
  }

  return sendError(res, 'Method Not Allowed', 405);
};
