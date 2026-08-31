/** TeleShort v2.2 — Referral Dashboard APIs */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');
const { checkRateLimit } = require('../utils/ratelimit');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'GET') return sendError(res, 'Method Not Allowed', 405);
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');

  const telegramId = Number(auth.user.id);
  const limit = await checkRateLimit(`ref_${telegramId}`, 'referral_read', 30, 60);
  if (!limit.allowed) return sendError(res, 'Too many referral requests. Please wait.', 429, 'RATE_LIMITED');

  try {
    const supabase = getSupabaseClient();
    const { data: me, error: meErr } = await supabase.from('users').select('id,telegram_id').eq('telegram_id', telegramId).maybeSingle();
    if (meErr) throw meErr;
    if (!me) return sendError(res, 'User account not found', 404, 'USER_NOT_FOUND');

    const [{ data: rows, error: refErr }, { data: configRow }] = await Promise.all([
      supabase.from('referrals').select('id,referred_tg_id,created_at').eq('referrer_tg_id', telegramId).order('created_at', { ascending: false }).limit(100),
      supabase.from('settings').select('value').eq('key', 'referral_config').maybeSingle()
    ]);
    if (refErr) throw refErr;
    const referredIds = (rows || []).map(r => Number(r.referred_tg_id)).filter(Number.isSafeInteger);
    let referredUsers = [];
    if (referredIds.length) {
      const { data, error } = await supabase.from('users').select('telegram_id,username,first_name,status,created_at').in('telegram_id', referredIds);
      if (error) throw error;
      referredUsers = data || [];
    }
    const byTg = new Map(referredUsers.map(u => [String(u.telegram_id), u]));
    const { data: rewardRows, error: rewardErr } = await supabase.from('wallet_transactions').select('amount,created_at,reference_id,metadata').eq('user_id', me.id).eq('type', 'REFERRAL_REWARD').order('created_at', { ascending: false }).limit(100);
    if (rewardErr) throw rewardErr;
    const totalEarned = (rewardRows || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const commissionPercent = Number(configRow?.value?.commission_percent ?? 10);

    return sendSuccess(res, {
      referral_link: `https://t.me/${process.env.BOT_USERNAME || 'myfileshareskbot'}?start=ref_${telegramId}`,
      referrals: (rows || []).map(r => ({ id:r.id, referred_telegram_id:r.referred_tg_id, user:byTg.get(String(r.referred_tg_id)) || null, created_at:r.created_at })),
      stats: { total_referrals: rows?.length || 0, total_earned: Number(totalEarned.toFixed(4)), commission_percent: commissionPercent }
    });
  } catch (error) {
    console.error('[Referral API Error]:', error);
    return sendError(res, error.message || 'Failed to load referral data', 500, 'REFERRAL_ERROR');
  }
};
