/** TeleShort v2.1 — Links API */
const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { validateUrl } = require('../utils/urlValidator');
const { generateShortSlug, getClientIp, hashIp } = require('../utils/crypto');
const { buildTelegramDeepLink } = require('../utils/telegram');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');

  const telegramUserId = Number(auth.user.id);
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return sendError(res, 'Invalid Telegram user ID', 400, 'INVALID_TELEGRAM_USER');

  try {
    const supabase = getSupabaseClient();
    const { data: userRecord, error: userErr } = await supabase
      .from('users').select('id,telegram_id,status,is_blocked').eq('telegram_id', telegramUserId).maybeSingle();
    if (userErr) throw userErr;
    if (!userRecord) return sendError(res, 'User account not found. Please reopen the Telegram Mini App.', 404, 'USER_NOT_FOUND');
    if (userRecord.status === 'BANNED' || userRecord.status === 'SUSPENDED' || userRecord.is_blocked === true) return sendError(res, 'Account is restricted. Cannot create links.', 403, 'ACCOUNT_RESTRICTED');

    if (req.method === 'POST') {
      const rateLimit = await checkRateLimit(`user_${telegramUserId}`, 'link_create', 15, 60);
      if (!rateLimit.allowed) return sendError(res, 'Link creation rate limit reached. Please wait a moment.', 429, 'RATE_LIMITED');
      const { url } = req.body || {};
      if (!url) return sendError(res, 'URL parameter is required', 400, 'MISSING_URL');
      const validation = validateUrl(url);
      if (!validation.valid) return sendError(res, validation.error || 'Invalid or unsafe destination URL', 400, 'INVALID_URL');

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { count: dailyCount, error: countErr } = await supabase.from('links').select('*', { count: 'exact', head: true }).eq('owner_id', userRecord.id).gte('created_at', startOfDay.toISOString());
      if (countErr) throw countErr;
      if ((dailyCount || 0) >= 50) return sendError(res, 'Daily link creation limit reached (50 links/day)', 429, 'DAILY_LIMIT_REACHED');

      let insertedLink = null;
      for (let retries = 0; retries < 5 && !insertedLink; retries++) {
        const shortCode = generateShortSlug(7);
        const { data, error } = await supabase.from('links').insert([{
          short_id: shortCode,
          short_code: shortCode,
          user_id: userRecord.id,
          owner_id: userRecord.id,
          original_url: validation.normalizedUrl,
          status: 'ACTIVE',
          clicks: 0,
          click_count: 0,
          earnings: 0,
          eligible_click_count: 0,
          total_earnings: 0
        }]).select('*').single();
        if (!error && data) { insertedLink = data; break; }
        if (error?.code === '23505') continue;
        throw error;
      }
      if (!insertedLink) return sendError(res, 'Failed to generate a unique short code', 500, 'SLUG_COLLISION_FAILED');
      const deepLink = buildTelegramDeepLink(insertedLink.short_code);
      return sendSuccess(res, { link: {
        id: insertedLink.id, short_code: insertedLink.short_code, short_url: deepLink, deep_link: deepLink,
        original_url: insertedLink.original_url, status: insertedLink.status, click_count: insertedLink.click_count || 0,
        eligible_click_count: insertedLink.eligible_click_count || 0, total_earnings: Number(insertedLink.total_earnings || 0), created_at: insertedLink.created_at
      }}, 201);
    }

    if (req.method === 'GET') {
      const page = Math.max(1, parseInt(req.query?.page || '1', 10));
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;
      const { data: links, error, count } = await supabase.from('links').select('*', { count: 'exact' }).eq('owner_id', userRecord.id).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      const formattedLinks = (links || []).map(l => {
        const linkUrl = buildTelegramDeepLink(l.short_code || l.short_id);
        return { id:l.id, short_code:l.short_code || l.short_id, short_url:linkUrl, deep_link:linkUrl, original_url:l.original_url, status:l.status, click_count:Number(l.click_count||l.clicks||0), clicks_count:Number(l.click_count||l.clicks||0), eligible_click_count:Number(l.eligible_click_count||0), total_earnings:Number(l.total_earnings||l.earnings||0), earnings:Number(l.total_earnings||l.earnings||0), created_at:l.created_at };
      });
      return sendSuccess(res, { links:formattedLinks, pagination:{page,limit,total:count||0,pages:Math.ceil((count||0)/limit)} });
    }
    return sendError(res, 'Method Not Allowed', 405);
  } catch (error) {
    console.error('[Links API Error]:', error);
    return sendError(res, error.message || 'Link operation failed', 500, 'LINK_API_ERROR');
  }
};
