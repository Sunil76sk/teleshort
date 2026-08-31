/** TeleShort v2.2 — Single Link Management Endpoint */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { buildTelegramDeepLink } = require('../utils/telegram');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');
  const linkId = req.query?.id;
  if (!linkId) return sendError(res, 'Link ID is required', 400, 'MISSING_LINK_ID');

  try {
    const supabase = getSupabaseClient();
    const { data: user, error: userErr } = await supabase.from('users').select('id,status,is_blocked').eq('telegram_id', Number(auth.user.id)).maybeSingle();
    if (userErr) throw userErr;
    if (!user) return sendError(res, 'User account not found', 404, 'USER_NOT_FOUND');
    if (user.status === 'BANNED' || user.status === 'SUSPENDED' || user.is_blocked) return sendError(res, 'Account is restricted', 403, 'ACCOUNT_RESTRICTED');

    const { data: link, error } = await supabase.from('links').select('id,short_code,original_url,status,click_count,eligible_click_count,total_earnings,created_at').eq('id', linkId).eq('owner_id', user.id).maybeSingle();
    if (error) throw error;
    if (!link) return sendError(res, 'Link not found or access denied', 404, 'NOT_FOUND');

    if (req.method === 'GET') {
      return sendSuccess(res, { link: {
        id: link.id,
        short_code: link.short_code,
        original_url: link.original_url,
        deep_link: buildTelegramDeepLink(link.short_code),
        status: link.status,
        click_count: Number(link.click_count || 0),
        eligible_click_count: Number(link.eligible_click_count || 0),
        total_earnings: Number(link.total_earnings || 0),
        created_at: link.created_at
      }});
    }

    if (req.method === 'DELETE') {
      const { error: deleteErr } = await supabase.from('links').update({ status: 'DISABLED', updated_at: new Date().toISOString() }).eq('id', link.id).eq('owner_id', user.id);
      if (deleteErr) throw deleteErr;
      return sendSuccess(res, { message: 'Link disabled successfully' });
    }

    return sendError(res, 'Method Not Allowed', 405);
  } catch (error) {
    console.error('[Link Detail Error]:', error);
    return sendError(res, error.message || 'Server error', 500, 'LINK_DETAIL_ERROR');
  }
};
