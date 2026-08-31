/** TeleShort v2.2 — Public Runtime Settings */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return sendError(res, 'Method Not Allowed', 405);
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('settings').select('key,value').in('key', [
      'publisher_payout_cpm', 'referral_config', 'ads_config', 'withdrawal_config',
      'force_join_config', 'maintenance_config', 'social_links'
    ]);
    if (error) throw error;
    const settings = {};
    for (const row of data || []) settings[row.key] = row.value || {};
    return sendSuccess(res, {
      publisher_payout_cpm: settings.publisher_payout_cpm || { rate_inr: 160 },
      referral_config: settings.referral_config || { commission_percent: 10 },
      ads_config: settings.ads_config || { ads_per_link: 2, timer_seconds: 5 },
      withdrawal_config: settings.withdrawal_config || { min_threshold_inr: 100 },
      force_join_config: settings.force_join_config || { enabled: false },
      maintenance_config: settings.maintenance_config || { enabled: false },
      social_links: settings.social_links || {}
    });
  } catch (error) {
    console.error('[Public Settings Error]:', error);
    return sendError(res, error.message || 'Failed to load settings', 500, 'SETTINGS_ERROR');
  }
};
