/**
 * TeleShort v2.1 — Telegram User Authentication Endpoint
 * POST /api/auth/telegram
 * Verifies Telegram WebApp initData and maps Telegram users to Supabase.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');
const { checkRateLimit } = require('../utils/ratelimit');
const { getClientIp, hashIp } = require('../utils/crypto');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return sendError(res, 'Method Not Allowed', 405);

  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);
  const rateLimit = await checkRateLimit(ipHash, 'auth_telegram', 30, 60);
  if (!rateLimit.allowed) return sendError(res, 'Too many requests. Please slow down.', 429, 'RATE_LIMITED');

  const { initData, startParam: clientStartParam } = req.body || {};
  // Trim environment secrets because accidental whitespace in Vercel's
  // environment variable editor otherwise makes every Telegram HMAC invalid.
  const botToken = typeof process.env.BOT_TOKEN === 'string' ? process.env.BOT_TOKEN.trim() : '';

  if (!botToken) return sendError(res, 'BOT_TOKEN is missing in server environment', 500, 'SERVER_CONFIG_ERROR');

  const authResult = verifyTelegramWebAppData(initData, botToken);
  if (!authResult.valid || !authResult.user) {
    return sendError(res, authResult.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const tgUser = authResult.user;
  const telegramId = Number(tgUser.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return sendError(res, 'Invalid Telegram user ID', 400, 'INVALID_TELEGRAM_USER');
  }

  const startParam = authResult.startParam || clientStartParam || null;

  try {
    const supabase = getSupabaseClient();
    const { data: existingUser, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (existingUser) {
      if (existingUser.status === 'BANNED' || existingUser.status === 'SUSPENDED' || existingUser.is_blocked === true) {
        return sendError(res, `Your account is ${existingUser.status?.toLowerCase() || 'restricted'}. Contact support.`, 403, 'ACCOUNT_RESTRICTED');
      }

      const { data: updatedUser, error: updateErr } = await supabase
        .from('users')
        .update({
          username: tgUser.username || existingUser.username,
          first_name: tgUser.first_name || existingUser.first_name,
          last_seen_at: new Date().toISOString()
        })
        .eq('id', existingUser.id)
        .select('*')
        .single();
      if (updateErr) throw updateErr;

      return sendSuccess(res, {
        user: {
          id: telegramId,
          telegram_id: telegramId,
          db_id: updatedUser.id,
          username: updatedUser.username,
          first_name: updatedUser.first_name,
          balance: updatedUser.balance,
          total_earned: updatedUser.total_earned,
          status: updatedUser.status
        },
        isNew: false
      });
    }

    let referrerTelegramId = null;
    if (typeof startParam === 'string' && startParam.startsWith('ref_')) {
      const parsedRef = Number.parseInt(startParam.slice(4), 10);
      if (Number.isSafeInteger(parsedRef) && parsedRef > 0 && parsedRef !== telegramId) {
        const { data: refUser } = await supabase
          .from('users')
          .select('telegram_id, status, is_blocked')
          .eq('telegram_id', parsedRef)
          .maybeSingle();
        if (refUser && refUser.status === 'ACTIVE' && refUser.is_blocked !== true) referrerTelegramId = parsedRef;
      }
    }

    const { data: newUser, error: insertErr } = await supabase
      .from('users')
      .insert([{
        telegram_id: telegramId,
        username: tgUser.username || null,
        first_name: tgUser.first_name || 'User',
        balance: 0,
        total_earnings: 0,
        total_earned: 0,
        status: 'ACTIVE',
        last_seen_at: new Date().toISOString()
      }])
      .select('*')
      .single();
    if (insertErr) throw insertErr;

    if (referrerTelegramId) {
      const { error: referralErr } = await supabase.from('referrals').insert([{
        referrer_tg_id: referrerTelegramId,
        referred_tg_id: telegramId,
        status: 'pending'
      }]);
      if (referralErr) console.warn('[Telegram Auth Referral Warning]:', referralErr.message);
    }

    return sendSuccess(res, {
      user: {
        id: telegramId,
        telegram_id: telegramId,
        db_id: newUser.id,
        username: newUser.username,
        first_name: newUser.first_name,
        balance: newUser.balance,
        total_earned: newUser.total_earned,
        status: newUser.status
      },
      isNew: true
    }, 201);
  } catch (error) {
    console.error('[Telegram Auth Error]:', error);
    return sendError(res, error.message || 'Authentication error', 500, 'AUTH_SERVER_ERROR');
  }
};
