/** TeleShort v2.2 — Safe production health/config check */
const { handleCors, sendSuccess } = require('./utils/response');
const { getSupabaseClient } = require('./utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ success:false, error:'Method Not Allowed' });
  const config = {
    supabase_url: Boolean(process.env.SUPABASE_URL),
    supabase_server_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
    bot_token: Boolean(process.env.BOT_TOKEN),
    telegram_bot_id: Number.isSafeInteger(Number(process.env.TELEGRAM_BOT_ID)) && Number(process.env.TELEGRAM_BOT_ID) > 0,
    challenge_secret: String(process.env.CHALLENGE_SECRET || '').length >= 32,
    admin_session_secret: String(process.env.ADMIN_SESSION_SECRET || '').length >= 32,
    redis: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  };
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('settings').select('key').limit(1);
    return sendSuccess(res, { ok: !error && Object.values(config).every(Boolean), database: !error, config });
  } catch (error) {
    return sendSuccess(res, { ok:false, database:false, config, error: 'Database health check failed' }, 503);
  }
};
