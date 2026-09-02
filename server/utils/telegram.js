/**
 * TeleShort v2.1 — Telegram Bot API & Deep-Link Utility
 * Server-side Force Join verification and Telegram Mini App links.
 */

const { redisGet, redisSet } = require('./redis');

const JOINED_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);

async function checkChatMember(channelId, telegramUserId, forceRefresh = false) {
  if (!channelId || !telegramUserId) {
    return { joined: false, status: 'INVALID_PARAMETERS', error: 'Missing channelId or userId' };
  }

  const botToken = String(process.env.BOT_TOKEN || '').trim();
  if (!botToken) {
    // NEVER fail open. Missing credentials must never unlock a destination.
    return { joined: false, status: 'CONFIGURATION_ERROR', error: 'Telegram BOT_TOKEN is not configured on the server' };
  }

  const sanitizedChannel = String(channelId).trim();
  const sanitizedUser = String(telegramUserId).trim();
  const cacheKey = `force_join:cache:${sanitizedChannel.toLowerCase()}:${sanitizedUser}`;

  if (!forceRefresh) {
    const cachedStatus = await redisGet(cacheKey);
    if (cachedStatus) {
      const normalized = String(cachedStatus).toLowerCase();
      return {
        joined: JOINED_STATUSES.has(normalized),
        status: String(cachedStatus).toUpperCase(),
        cached: true
      };
    }
  }

  try {
    const apiUrl = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChatMember?chat_id=${encodeURIComponent(sanitizedChannel)}&user_id=${encodeURIComponent(sanitizedUser)}`;
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      return {
        joined: false,
        status: 'TELEGRAM_HTTP_ERROR',
        error: `Telegram API returned HTTP ${response.status}`
      };
    }

    const data = await response.json();
    if (!data.ok) {
      return {
        joined: false,
        status: 'CHECK_FAILED',
        error: data.description || 'Telegram membership verification failed'
      };
    }

    const memberStatus = String(data.result?.status || '').toLowerCase();
    const isMember = JOINED_STATUSES.has(memberStatus);

    // Only cache an authoritative membership result. Never cache an error as joined.
    await redisSet(cacheKey, isMember ? memberStatus.toUpperCase() : 'NOT_MEMBER', isMember ? 3600 : 120);

    return {
      joined: isMember,
      status: memberStatus ? memberStatus.toUpperCase() : 'UNKNOWN',
      cached: false
    };
  } catch (error) {
    return {
      joined: false,
      status: 'NETWORK_ERROR',
      error: error.message || 'Telegram membership request failed'
    };
  }
}

/**
 * Generate the MAIN Telegram Mini App link.
 * Main Mini App format: https://t.me/<bot>?startapp=<parameter>
 */
function buildTelegramDeepLink(shortCode) {
  const botUsername = (process.env.BOT_USERNAME || 'myfileshareskbot').replace(/^@/, '').trim();
  const configuredShortName = (process.env.APP_SHORT_NAME || '').replace(/^@/, '').trim();
  const cleanCode = String(shortCode || '').replace(/^link_/, '').trim();

  if (configuredShortName && configuredShortName.toLowerCase() !== botUsername.toLowerCase()) {
    return `https://t.me/${botUsername}/${configuredShortName}?startapp=link_${encodeURIComponent(cleanCode)}`;
  }

  return `https://t.me/${botUsername}?startapp=link_${encodeURIComponent(cleanCode)}`;
}

function buildTelegramVisitorLink(shortCode) {
  return buildTelegramDeepLink(shortCode);
}

module.exports = { checkChatMember, buildTelegramDeepLink, buildTelegramVisitorLink };
