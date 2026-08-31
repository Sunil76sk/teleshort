/**
 * TeleShort v2.1 — Telegram Bot API & Deep-Link Utility
 * Provides server-side Force Join verification with Upstash Redis caching and dynamic link formatting.
 */

const { redisGet, redisSet } = require('./redis');

/**
 * Check if a Telegram user is a member of the required channel using getChatMember
 * @param {string} channelId - e.g. "@TeleShortOfficial" or "-100123456789"
 * @param {number|string} telegramUserId - Telegram User ID
 * @param {boolean} forceRefresh - If true, bypasses Redis cache (e.g. "I've Joined" button)
 * @returns {Promise<{ joined: boolean, status: string, error?: string }>}
 */
async function checkChatMember(channelId, telegramUserId, forceRefresh = false) {
  if (!channelId || !telegramUserId) {
    return { joined: false, status: 'INVALID_PARAMETERS', error: 'Missing channelId or userId' };
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram Bot API] BOT_TOKEN missing on server');
    return { joined: true, status: 'BYPASS_NO_TOKEN', error: 'BOT_TOKEN missing' };
  }

  const sanitizedChannel = String(channelId).trim();
  const sanitizedUser = String(telegramUserId).trim();
  const cacheKey = `force_join:cache:${sanitizedChannel.toLowerCase()}:${sanitizedUser}`;

  // 1. Check Redis Cache (unless forceRefresh is requested)
  if (!forceRefresh) {
    const cachedStatus = await redisGet(cacheKey);
    if (cachedStatus) {
      return {
        joined: cachedStatus === 'MEMBER' || cachedStatus === 'ADMIN' || cachedStatus === 'CREATOR',
        status: cachedStatus,
        cached: true
      };
    }
  }

  // 2. Fetch from official Telegram Bot API
  try {
    const apiUrl = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(sanitizedChannel)}&user_id=${encodeURIComponent(sanitizedUser)}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    const data = await response.json();

    if (!data.ok) {
      console.warn(`[Telegram getChatMember Error] Channel: ${sanitizedChannel}, User: ${sanitizedUser}, Error:`, data.description);
      // Graceful error handling (e.g. Bot not admin of channel, or user not found)
      return {
        joined: false,
        status: 'CHECK_FAILED',
        error: data.description || 'Failed to verify channel membership'
      };
    }

    const memberStatus = data.result?.status; // 'creator', 'administrator', 'member', 'restricted', 'left', 'kicked'
    const isMember = ['creator', 'administrator', 'member', 'restricted'].includes(memberStatus);

    // 3. Cache positive results in Redis for 1 hour (3600 seconds)
    if (isMember) {
      await redisSet(cacheKey, memberStatus.toUpperCase(), 3600);
    } else {
      // Do not permanently cache "left" or "not joined" so user can join and retry immediately
      await redisSet(cacheKey, 'NOT_MEMBER', 120); // Short 2-minute cache
    }

    return {
      joined: isMember,
      status: memberStatus ? memberStatus.toUpperCase() : 'UNKNOWN',
      cached: false
    };
  } catch (error) {
    console.error('[Telegram API Network Error]:', error.message);
    return {
      joined: false,
      status: 'NETWORK_ERROR',
      error: error.message
    };
  }
}

/**
 * Generate official Telegram Mini App Deep-Link for a short code
 * @param {string} shortCode - Unique Base62 short slug
 * @returns {string} Fully qualified t.me startapp deep-link
 */
function buildTelegramDeepLink(shortCode) {
  const botUsername = process.env.BOT_USERNAME || 'TeleShortLink_bot';
  const appShortName = process.env.APP_SHORT_NAME || 'TeleShortLink';
  return `https://t.me/${botUsername}/${appShortName}?startapp=link_${shortCode}`;
}

module.exports = {
  checkChatMember,
  buildTelegramDeepLink
};
