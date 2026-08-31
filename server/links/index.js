/**
 * TeleShort v2.1 — Links API Endpoint
 * POST /api/links — Create a new short link
 * GET /api/links — List authenticated user's links
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateTelegramUser } = require('../utils/auth');
const { validateUrl } = require('../utils/urlValidator');
const { generateShortSlug, getClientIp, hashIp } = require('../utils/crypto');
const { buildTelegramDeepLink } = require('../utils/telegram');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  // 1. Authenticate Telegram User
  const auth = authenticateTelegramUser(req);
  if (!auth.authenticated || !auth.user) {
    return sendError(res, auth.error || 'Authentication required', 401, 'UNAUTHORIZED');
  }

  const userId = auth.user.id;
  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);

  // =========================================================================
  // POST /api/links — Create Link
  // =========================================================================
  if (req.method === 'POST') {
    // Sliding Window Rate Limit: Max 15 link creations per minute per user
    const rateLimit = await checkRateLimit(`user_${userId}`, 'link_create', 15, 60);
    if (!rateLimit.allowed) {
      return sendError(res, 'Link creation rate limit reached. Please wait a moment.', 429, 'RATE_LIMITED');
    }

    const { url } = req.body || {};
    if (!url) {
      return sendError(res, 'URL parameter is required', 400, 'MISSING_URL');
    }

    // 2. Validate URL Security & Normalization
    const validation = validateUrl(url);
    if (!validation.valid) {
      return sendError(res, validation.error || 'Invalid or unsafe destination URL', 400, 'INVALID_URL');
    }

    try {
      const supabase = getSupabaseClient();

      // 3. Verify user status
      const { data: userRecord, error: userErr } = await supabase
        .from('users')
        .select('id, status')
        .eq('id', userId)
        .single();

      if (userErr || !userRecord) {
        return sendError(res, 'User account not found', 404, 'USER_NOT_FOUND');
      }

      if (userRecord.status === 'BANNED' || userRecord.status === 'SUSPENDED') {
        return sendError(res, `Account is ${userRecord.status.toLowerCase()}. Cannot create links.`, 403, 'ACCOUNT_RESTRICTED');
      }

      // 4. Daily Link Limit Check (e.g. max 50 links per day)
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const { count: dailyCount, error: countErr } = await supabase
        .from('links')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', userId)
        .gte('created_at', startOfDay.toISOString());

      if (!countErr && dailyCount >= 50) {
        return sendError(res, 'Daily link creation limit reached (50 links/day)', 429, 'DAILY_LIMIT_REACHED');
      }

      // 5. Generate collision-resistant short slug with DB retry loop
      let shortCode = null;
      let insertedLink = null;
      let retries = 0;
      const MAX_RETRIES = 5;

      while (retries < MAX_RETRIES) {
        const candidateSlug = generateShortSlug(7);
        const { data, error } = await supabase
          .from('links')
          .insert([
            {
              short_code: candidateSlug,
              owner_id: userId, // Derived strictly from verified auth
              original_url: validation.normalizedUrl,
              status: 'ACTIVE',
              click_count: 0,
              eligible_click_count: 0,
              total_earnings: 0.0000
            }
          ])
          .select('*')
          .single();

        if (!error && data) {
          shortCode = candidateSlug;
          insertedLink = data;
          break;
        }

        // If duplicate key error on short_code, retry with new slug
        if (error && error.code === '23505') {
          retries++;
          continue;
        } else {
          throw error;
        }
      }

      if (!insertedLink) {
        return sendError(res, 'Failed to generate unique link code after retries', 500, 'SLUG_COLLISION_FAILED');
      }

      const deepLink = buildTelegramDeepLink(insertedLink.short_code);

      return sendSuccess(res, {
        link: {
          id: insertedLink.id,
          short_code: insertedLink.short_code,
          short_url: deepLink,
          deep_link: deepLink,
          original_url: insertedLink.original_url,
          status: insertedLink.status,
          click_count: insertedLink.click_count,
          eligible_click_count: insertedLink.eligible_click_count,
          total_earnings: insertedLink.total_earnings,
          created_at: insertedLink.created_at
        }
      }, 201);
    } catch (error) {
      console.error('[Create Link Error]:', error);
      return sendError(res, error.message || 'Failed to create link', 500);
    }
  }

  // =========================================================================
  // GET /api/links — List User's Links (Anti-IDOR: only user's own links)
  // =========================================================================
  if (req.method === 'GET') {
    try {
      const supabase = getSupabaseClient();
      const page = parseInt(req.query?.page || '1', 10);
      const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || '20', 10)));
      const offset = (page - 1) * limit;

      const { data: links, error, count } = await supabase
        .from('links')
        .select('*', { count: 'exact' })
        .eq('owner_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const formattedLinks = (links || []).map(l => {
        const linkUrl = buildTelegramDeepLink(l.short_code);
        return {
          id: l.id,
          short_code: l.short_code,
          short_url: linkUrl,
          deep_link: linkUrl,
          original_url: l.original_url,
          status: l.status,
          click_count: l.click_count,
          clicks_count: l.click_count,
          eligible_click_count: l.eligible_click_count,
          total_earnings: l.total_earnings,
          earnings: l.total_earnings,
          created_at: l.created_at
        };
      });

      return sendSuccess(res, {
        links: formattedLinks,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });
    } catch (error) {
      console.error('[List Links Error]:', error);
      return sendError(res, error.message || 'Failed to fetch links', 500);
    }
  }

  return sendError(res, 'Method Not Allowed', 405);
};
