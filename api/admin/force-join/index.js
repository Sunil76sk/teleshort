/**
 * TeleShort v2.1 — Admin Force Join Management Endpoint (Phase 8)
 * GET /api/admin/force-join — View Force Join channel configuration
 * POST /api/admin/force-join — Update or Add Force Join channel
 */

const { handleCors, sendSuccess, sendError } = require('../../utils/response');
const { authenticateAdmin } = require('../../utils/auth');
const { getSupabaseClient } = require('../../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // =========================================================================
  // GET /api/admin/force-join — View Channels
  // =========================================================================
  if (req.method === 'GET') {
    const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
    if (!auth.authenticated || !auth.admin) {
      return sendError(res, auth.error || 'Admin authorization required', 403, 'FORBIDDEN');
    }

    try {
      const supabase = getSupabaseClient();
      const { data: channels, error } = await supabase
        .from('force_join_channels')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const { data: setting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'force_join_config')
        .single();

      return sendSuccess(res, {
        channels: channels || [],
        global_config: setting?.value || { enabled: false }
      });
    } catch (error) {
      console.error('[Admin Get Force Join Error]:', error);
      return sendError(res, error.message || 'Error fetching force join channels', 500);
    }
  }

  // =========================================================================
  // POST /api/admin/force-join — Update Channel Configuration
  // =========================================================================
  if (req.method === 'POST') {
    const auth = authenticateAdmin(req, ['SUPER_ADMIN']);
    if (!auth.authenticated || !auth.admin) {
      return sendError(res, 'Only SUPER_ADMIN can configure Force Join channels', 403, 'FORBIDDEN');
    }

    const { channel_id, channel_title, invite_link, is_active = true, enabled = true } = req.body || {};

    if (!channel_id || typeof channel_id !== 'string') {
      return sendError(res, 'Valid Telegram channel_id (e.g. @TeleShortOfficial or -100123456789) is required', 400, 'INVALID_CHANNEL_ID');
    }

    try {
      const supabase = getSupabaseClient();

      // Upsert into force_join_channels table
      const { data: channel, error: chErr } = await supabase
        .from('force_join_channels')
        .upsert({
          channel_id: channel_id.trim(),
          channel_title: channel_title ? String(channel_title).trim() : null,
          invite_link: invite_link ? String(invite_link).trim() : null,
          is_active: Boolean(is_active)
        })
        .select('*')
        .single();

      if (chErr) throw chErr;

      // Update global setting
      await supabase
        .from('settings')
        .upsert({
          key: 'force_join_config',
          value: {
            enabled: Boolean(enabled),
            channel_id: channel_id.trim(),
            channel_title: channel_title || '',
            invite_link: invite_link || '',
            cache_ttl_seconds: 3600
          },
          updated_at: new Date().toISOString()
        });

      // Audit Log
      await supabase.from('audit_logs').insert([
        {
          actor_type: 'ADMIN',
          actor_id: auth.admin.userId || auth.admin.username || 'SUPER_ADMIN',
          action: 'FORCE_JOIN_UPDATED',
          target_type: 'FORCE_JOIN_CHANNEL',
          target_id: channel_id.trim(),
          metadata: { channel_id, is_active, enabled }
        }
      ]);

      return sendSuccess(res, {
        channel,
        message: 'Force Join channel configuration updated successfully'
      });
    } catch (error) {
      console.error('[Admin Update Force Join Error]:', error);
      return sendError(res, error.message || 'Error updating force join channels', 500);
    }
  }

  return sendError(res, 'Method Not Allowed', 405);
};
