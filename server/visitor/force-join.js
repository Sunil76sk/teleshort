/**
 * TeleShort — Force Join Channel Verification Endpoint
 * POST /api/visitor/force-join
 * Verifies membership in every required channel.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { checkChatMember } = require('../utils/telegram');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

// Production fallback for the currently configured TeleShort channels.
// This is server-side only; credentials are never exposed to the browser.
const DEFAULT_FORCE_JOIN_CHANNELS = [
  { channel_id: '-1002471479638', username: '@kannadanewmovie_sk', url: 'https://t.me/kannadanewmovie_sk' },
  { channel_id: '-1001565776206', username: '', url: '' }
];

function normalizeChannels(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return { channel_id: String(item).trim(), username: '', url: '' };
      }
      if (!item || typeof item !== 'object') return null;
      const channel_id = String(item.channel_id || item.id || '').trim();
      if (!channel_id) return null;
      const username = String(item.username || item.channel_username || '').trim();
      const url = String(item.url || (username ? `https://t.me/${username.replace(/^@/, '')}` : '')).trim();
      return { channel_id, username, url };
    })
    .filter(Boolean)
    .filter((channel, index, all) => all.findIndex((x) => x.channel_id === channel.channel_id) === index);
}

function getEnvChannels() {
  const configured = String(process.env.FORCE_JOIN_CHANNELS || '').trim();
  if (!configured) return [];
  try {
    const parsed = JSON.parse(configured);
    const channels = normalizeChannels(parsed);
    if (channels.length) return channels;
  } catch (_) {
    const channels = normalizeChannels(configured.split(',').map((x) => x.trim()));
    if (channels.length) return channels;
  }
  return [];
}

async function loadRequiredChannels() {
  // Preferred: explicit server environment configuration.
  const envChannels = getEnvChannels();
  if (envChannels.length) return envChannels;

  // Backward-compatible attempt for the previous key/value settings design.
  // The current committed database.sql uses a different settings shape, so failure
  // here must not unlock the visitor; we fall back to the known server configuration.
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'force_join_config')
      .maybeSingle();

    if (!error && data?.value) {
      const config = data.value;
      const channels = normalizeChannels(config.channels || config.required_channels || config.channel_ids || config.channel_id);
      if (channels.length) return channels;
      if (config.enabled === false) return [];
    }
  } catch (_) {
    // Schema mismatch/temporary DB issue: use the safe server fallback below.
  }

  return DEFAULT_FORCE_JOIN_CHANNELS;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const { initData, force_refresh = false } = req.body || {};
  const botToken = process.env.BOT_TOKEN;

  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;
  const rateLimit = await checkRateLimit(`fj_${visitorId}`, 'force_join_check', 20, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many verification attempts. Please wait a few seconds.', 429, 'RATE_LIMITED');
  }

  try {
    const requiredChannels = await loadRequiredChannels();

    // Empty list means Force Join is intentionally disabled.
    if (!requiredChannels.length) {
      return sendSuccess(res, { joined: true, channels: [], message: 'Force Join is disabled.' });
    }

    const results = await Promise.all(
      requiredChannels.map(async (channel) => {
        const result = await checkChatMember(channel.channel_id, visitorId, Boolean(force_refresh));
        return {
          channel_id: channel.channel_id,
          username: channel.username,
          url: channel.url,
          joined: Boolean(result.joined),
          status: result.status,
          cached: Boolean(result.cached),
          error: result.joined ? undefined : result.error
        };
      })
    );

    const joined = results.every((item) => item.joined === true);

    return sendSuccess(res, {
      joined,
      status: joined ? 'ALL_JOINED' : 'JOIN_REQUIRED',
      cached: results.some((item) => item.cached),
      channel_id: results[0]?.channel_id,
      channel_url: results[0]?.url,
      channels: results
    });
  } catch (error) {
    console.error('[Force Join Verification Error]:', error);
    return sendError(res, error.message || 'Membership verification failed', 500, 'FORCE_JOIN_CHECK_FAILED');
  }
};
