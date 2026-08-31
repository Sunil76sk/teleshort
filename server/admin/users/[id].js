/** TeleShort v2.2 — Admin User Detail & Status */
const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const userId = req.query?.id;
  if (!userId) return sendError(res, 'User ID is required', 400, 'MISSING_USER_ID');

  if (req.method === 'GET') {
    const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
    if (!auth.authenticated || !auth.admin) return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
    try {
      const supabase = getSupabaseClient();
      const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', userId).single();
      if (userErr || !user) return sendError(res, 'User not found', 404, 'NOT_FOUND');
      const { count: linksCount } = await supabase.from('links').select('*', { count: 'exact', head: true }).eq('owner_id', userId);
      const { count: referralsCount } = await supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('referrer_tg_id', user.telegram_id);
      const { data: withdrawals } = await supabase.from('withdrawals').select('amount,status').eq('user_id', userId);
      const { data: fraudEvents } = await supabase.from('fraud_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
      const totalWithdrawn = (withdrawals || []).filter(w => String(w.status).toUpperCase() === 'PAID').reduce((s, w) => s + Number(w.amount || 0), 0);
      return sendSuccess(res, { user: { id:user.id, telegram_id:user.telegram_id, username:user.username, first_name:user.first_name, available_balance:Number(user.balance||0), total_earned:Number(user.total_earned||0), total_withdrawn:Number(totalWithdrawn.toFixed(2)), referred_by:user.referred_by, status:user.status, created_at:user.created_at, last_seen_at:user.last_seen_at }, stats:{ links_count:linksCount||0, referrals_count:referralsCount||0, fraud_events_count:fraudEvents?.length||0 }, recent_fraud_events:fraudEvents||[] });
    } catch (error) {
      console.error('[Admin User Detail Error]:', error);
      return sendError(res, error.message || 'Error fetching user details', 500, 'ADMIN_USER_DETAIL_ERROR');
    }
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'SUPPORT_ADMIN']);
    if (!auth.authenticated || !auth.admin) return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
    const { action, reason } = req.body || {};
    const normalized = String(action || '').toUpperCase();
    if (!new Set(['BAN','UNBAN','SUSPEND','UNSUSPEND']).has(normalized)) return sendError(res, 'Invalid action. Use BAN, UNBAN, SUSPEND, or UNSUSPEND.', 400, 'INVALID_ACTION');
    if (['BAN','SUSPEND'].includes(normalized) && (!reason || !String(reason).trim())) return sendError(res, 'A clear reason is required when banning or suspending a user.', 400, 'REASON_REQUIRED');
    const newStatus = ['BAN','SUSPEND'].includes(normalized) ? (normalized === 'BAN' ? 'BANNED' : 'SUSPENDED') : 'ACTIVE';
    try {
      const supabase = getSupabaseClient();
      const { data: user, error } = await supabase.from('users').update({ status:newStatus, is_blocked:newStatus==='BANNED', updated_at:new Date().toISOString() }).eq('id',userId).select('id,telegram_id,username,status,is_blocked').single();
      if (error || !user) return sendError(res, 'Failed to update user status', 500, 'UPDATE_FAILED');
      await supabase.from('audit_logs').insert([{ actor_type:'ADMIN', actor_id:String(auth.admin.id||auth.admin.username||'ADMIN'), action:`USER_${normalized}`, target_type:'USER', target_id:String(userId), metadata:{new_status:newStatus,reason:reason||'Admin action'} }]);
      return sendSuccess(res, { user, message:`User ${userId} status updated to ${newStatus}` });
    } catch (error) {
      console.error('[Admin Update User Status Error]:', error);
      return sendError(res, error.message || 'Error updating user status', 500, 'ADMIN_USER_UPDATE_ERROR');
    }
  }
  return sendError(res, 'Method Not Allowed', 405);
};
