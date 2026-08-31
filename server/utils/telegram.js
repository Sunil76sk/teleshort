/**
 * TeleShort v2.1 — Telegram Bot API & Deep-Link Utility
 * Provides server-side Force Join verification and Main Mini App deep-link formatting.
 */

const { redisGet, redisSet } = require('./redis');

async function checkChatMember(channelId, telegramUserId, forceRefresh = false) {
  if (!channelId || !telegramUserId) return { joined: false, status: 'INVALID_PARAMETERS', error: 'Missing channelId or userId' };
  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return { joined: true, status: 'BYPASS_NO_TOKEN', error: 'BOT_TOKEN missing' };
  const sanitizedChannel = String(channelId).trim();
  const sanitizedUser = String(telegramUserId).trim();
  const cacheKey = `force_join:cache:${sanitizedChannel.toLowerCase()}:${sanitizedUser}`;

  if (!forceRefresh) {
    const cachedStatus = await redisGet(cacheKey);
    if (cachedStatus) return { joined: ['MEMBER','ADMIN','CREATOR','RESTRICTED'].includes(cachedStatus), status: cachedStatus, cached: true };
  }

  try {
    const apiUrl = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(sanitizedChannel)}&user_id=${encodeURIComponent(sanitizedUser)}`;
    const response = await fetch(apiUrl, { method: 'GET', headers: { Accept: 'application/json' } });
    const data = await response.json();
    if (!data.ok) return { joined: false, status: 'CHECK_FAILED', error: data.description || 'Failed to verify channel membership' };
    const memberStatus = data.result?.status;
    const isMember = ['creator', 'administrator', 'member', 'restricted'].includes(memberStatus);
    if (isMember) await redisSet(cacheKey, memberStatus.toUpperCase(), 3600);
    else await redisSet(cacheKey, 'NOT_MEMBER', 120);
    return { joined: isMember, status: memberStatus ? memberStatus.toUpperCase() : 'UNKNOWN', cached: false };
  } catch (error) {
    return { joined: false, status: 'NETWORK_ERROR', error: error.message };
  }
}

/**
 * Generate the MAIN Telegram Mini App link.
 * Main Mini App format: https://t.me/<bot>?startapp=<parameter>
 * A /<short_name> path is used only when a distinct APP_SHORT_NAME is configured.
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

function buildTelegramVisitorLink(shortCode) { return buildTelegramDeepLink(shortCode); }
module.exports = { checkChatMember, buildTelegramDeepLink, buildTelegramVisitorLink };
