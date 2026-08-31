/**
 * TeleShort v2.1 — Admin Settings API Endpoint (Phase 8 Enhanced)
 * GET /api/admin/settings — View platform configuration
 * PATCH /api/admin/settings — Update platform configuration with strict range validation & versioning
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateAdmin } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // 1. Authenticate Admin (View allowed for all admin roles)
  const auth = authenticateAdmin(req);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authentication required', 401, 'UNAUTHORIZED');
  }

  const supabase = getSupabaseClient();

  // =========================================================================
  // GET /api/admin/settings — Retrieve Settings
  // =========================================================================
  if (req.method === 'GET') {
    try {
      const { data: settings, error } = await supabase
        .from('settings')
        .select('key, value, updated_at');

      if (error) throw error;

      const formattedSettings = {};
      (settings || []).forEach(s => {
        formattedSettings[s.key] = s.value;
      });

      return sendSuccess(res, { settings: formattedSettings });
    } catch (error) {
      console.error('[Admin Get Settings Error]:', error);
      return sendError(res, error.message || 'Failed to retrieve settings', 500);
    }
  }

  // =========================================================================
  // PATCH /api/admin/settings — Update Settings (Strictly SUPER_ADMIN)
  // =========================================================================
  if (req.method === 'PATCH') {
    if (auth.admin.role !== 'SUPER_ADMIN') {
      return sendError(res, 'Only SUPER_ADMIN can modify system configuration', 403, 'FORBIDDEN');
    }

    const { key, value, reason } = req.body || {};
    if (!key || value === undefined) {
      return sendError(res, 'Key and value are required in body', 400, 'INVALID_BODY');
    }

    const allowedKeys = new Set([
      'publisher_payout_cpm',
      'ads_config',
      'referral_config',
      'withdrawal_config',
      'force_join_config',
      'maintenance_config',
      'social_links'
    ]);

    if (!allowedKeys.has(key)) {
      return sendError(res, `Invalid setting key: "${key}"`, 400, 'INVALID_KEY');
    }

    // Strict Range Validations
    if (key === 'publisher_payout_cpm') {
      if (value.rate_inr !== undefined && (typeof value.rate_inr !== 'number' || value.rate_inr < 0)) {
        return sendError(res, 'Publisher Payout CPM INR must be a non-negative number', 400, 'INVALID_SETTING_RANGE');
      }
      if (value.rate_usd !== undefined && (typeof value.rate_usd !== 'number' || value.rate_usd < 0)) {
        return sendError(res, 'Publisher Payout CPM USD must be a non-negative number', 400, 'INVALID_SETTING_RANGE');
      }
    }

    if (key === 'referral_config') {
      const pct = value.commission_percent;
      if (pct !== undefined && (typeof pct !== 'number' || pct < 0 || pct > 100)) {
        return sendError(res, 'Referral commission percent must be between 0 and 100', 400, 'INVALID_SETTING_RANGE');
      }
    }

    if (key === 'withdrawal_config') {
      const minInr = value.min_threshold_inr;
      if (minInr !== undefined && (typeof minInr !== 'number' || minInr < 1.00)) {
        return sendError(res, 'Minimum withdrawal threshold must be at least ₹1.00', 400, 'INVALID_SETTING_RANGE');
      }
    }

    if (key === 'ads_config') {
      const count = value.ads_per_link;
      if (count !== undefined && (typeof count !== 'number' || count < 1 || count > 5)) {
        return sendError(res, 'Ads per link must be between 1 and 5', 400, 'INVALID_SETTING_RANGE');
      }
    }

    try {
      // 1. Fetch current setting value for audit versioning
      const { data: currentSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', key)
        .single();

      const oldValue = currentSetting?.value || null;

      // 2. Update setting
      const { data, error } = await supabase
        .from('settings')
        .upsert({
          key,
          value,
          updated_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (error) throw error;

      // 3. Log audit event with previous and new values
      await supabase.from('audit_logs').insert([
        {
          actor_type: 'ADMIN',
          actor_id: auth.admin.userId || auth.admin.username || 'SUPER_ADMIN',
          action: 'UPDATE_SETTINGS',
          target_type: 'SETTINGS',
          target_id: key,
          metadata: {
            key,
            old_value: oldValue,
            new_value: value,
            reason: reason || 'Admin settings update'
          }
        }
      ]);

      return sendSuccess(res, { setting: data, message: `Setting "${key}" updated successfully` });
    } catch (error) {
      console.error('[Admin Update Settings Error]:', error);
      return sendError(res, error.message || 'Failed to update setting', 500);
    }
  }

  return sendError(res, 'Method Not Allowed', 405);
};
