/**
 * TeleShort — Shared Force Join Configuration
 * Single source of truth for required visitor channels.
 */

const { getSupabaseClient } = require('../utils/db');

const DEFAULT_FORCE_JOIN_CHANNELS = [
  {
    channel_id: '-1002471479638',
    username: '',
    url: 'https://t.me/+IbHLv5W4jpBkYzBl'
  },
  {
    channel_id: '-1001565776206',
    username: '@kannadanewmovie_sk',
    url: 'https://t.me/kannadanewmovie_sk'
  }
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
      const url = String(
        item.url || item.invite_link ||
        (username ? `https://t.me/${username.replace(/^@/, '')}` : '')
      ).trim();
      return { channel_id, username, url };
    })
    .filter(Boolean)
    .filter((channel, index, all) =>
      all.findIndex((x) => x.channel_id === channel.channel_id) === index
    );
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
  const envChannels = getEnvChannels();
  if (envChannels.length) return envChannels;

  try {
    const supabase = getSupabaseClient();

    // New schema: multiple active Force Join channels.
    const { data: rows, error: rowsError } = await supabase
      .from('force_join_channels')
      .select('channel_id, channel_title, invite_link, is_active')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (!rowsError && Array.isArray(rows) && rows.length) {
      const channels = normalizeChannels(rows.map((row) => ({
        channel_id: row.channel_id,
        username: row.channel_id?.startsWith('@') ? row.channel_id : '',
        url: row.invite_link || ''
      })));
      if (channels.length) return channels;
    }

    // Backward-compatible key/value configuration.
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'force_join_config')
      .maybeSingle();

    if (!error && data?.value) {
      const config = data.value;
      if (config.enabled === false) return [];
      const channels = normalizeChannels(
        config.channels || config.required_channels || config.channel_ids || config.channel_id
      );
      if (channels.length) return channels;
    }
  } catch (_) {
    // Never disable Force Join because configuration/schema lookup failed.
  }

  return DEFAULT_FORCE_JOIN_CHANNELS;
}

module.exports = { DEFAULT_FORCE_JOIN_CHANNELS, normalizeChannels, loadRequiredChannels };
