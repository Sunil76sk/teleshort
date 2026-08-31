/**
 * TeleShort v2.1 — Single Link Management Endpoint
 * GET /api/links/[id] — Fetch specific link (Anti-IDOR)
 * DELETE /api/links/[id] — Disable/delete specific link (Anti-IDOR)
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { buildTelegramDeepLink } = require('../utils/telegram');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) {
    return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');
  }

  const userId = auth.user.id;
  const linkId = req.query?.id;

  if (!linkId) {
    return sendError(res, 'Link ID is required', 400, 'MISSING_LINK_ID');
  }

  try {
    const supabase = getSupabaseClient();

    // =========================================================================
    // GET /api/links/[id] — Retrieve link details (Anti-IDOR)
    // =========================================================================
    if (req.method === 'GET') {
      const { data: link, error } = await supabase
        .from('links')
        .select('*')
        .eq('id', linkId)
        .eq('owner_id', userId) // Strict ownership check
        .single();

      if (error || !link) {
        return sendError(res, 'Link not found or access denied', 404, 'NOT_FOUND');
      }

      return sendSuccess(res, {
        link: {
          id: link.id,
          short_code: link.short_code,
          original_url: link.original_url,
          deep_link: buildTelegramDeepLink(link.short_code),
          status: link.status,
          click_count: link.click_count,
          eligible_click_count: link.eligible_click_count,
          total_earnings: link.total_earnings,
          created_at: link.created_at
        }
      });
    }

    // =========================================================================
    // DELETE /api/links/[id] — Delete or disable link (Anti-IDOR)
    // =========================================================================
    if (req.method === 'DELETE') {
      // Check ownership first
      const { data: link, error: checkErr } = await supabase
        .from('links')
        .select('id, owner_id')
        .eq('id', linkId)
        .eq('owner_id', userId)
        .single();

      if (checkErr || !link) {
        return sendError(res, 'Link not found or access denied', 404, 'NOT_FOUND');
      }

      const { error: deleteErr } = await supabase
        .from('links')
        .delete()
        .eq('id', linkId)
        .eq('owner_id', userId);

      if (deleteErr) throw deleteErr;

      return sendSuccess(res, { message: 'Link deleted successfully' });
    }

    return sendError(res, 'Method Not Allowed', 405);
  } catch (error) {
    console.error('[Link Detail Error]:', error);
    return sendError(res, error.message || 'Server error', 500);
  }
};
