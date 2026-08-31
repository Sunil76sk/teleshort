/**
 * TeleShort v2.1 — Telegram User Authentication Endpoint
 * POST /api/auth/telegram
 * Cryptographically verifies Telegram WebApp initData, creates or updates user, and links referrals.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');
const { checkRateLimit } = require('../utils/ratelimit');
const { getClientIp, hashIp } = require('../utils/crypto');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);

  // Velocity rate limit on auth endpoint
  const rateLimit = await checkRateLimit(ipHash, 'auth_telegram', 30, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many requests. Please slow down.', 429, 'RATE_LIMITED');
  }

  const { initData, startParam: clientStartParam } = req.body || {};
  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    return sendError(res, 'BOT_TOKEN is missing in server environment', 500);
  }

  const authResult = verifyTelegramWebAppData(initData, botToken);
  if (!authResult.valid || !authResult.user) {
    return sendError(res, authResult.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const tgUser = authResult.user;
  const startParam = authResult.startParam || clientStartParam;

  try {
    const supabase = getSupabaseClient();

    // 1. Check if user already exists
    const { data: existingUser, error: fetchErr } = await supabase
      .from('users')
      .select('*')
      .eq('id', tgUser.id)
      .single();

    if (fetchErr && fetchErr.code !== 'PGRST116') {
      // PGRST116 is "Row not found"
      throw fetchErr;
    }

    // 2. Check if user is blocked or banned
    if (existingUser) {
      if (existingUser.status === 'BANNED' || existingUser.status === 'SUSPENDED') {
        return sendError(res, `Your account is ${existingUser.status.toLowerCase()}. Contact support.`, 403, 'ACCOUNT_RESTRICTED');
      }

      // Update last seen and profile metadata
      const { data: updatedUser, error: updateErr } = await supabase
        .from('users')
        .update({
          username: tgUser.username || existingUser.username,
          first_name: tgUser.first_name || existingUser.first_name,
          last_seen_at: new Date().toISOString()
        })
        .eq('id', tgUser.id)
        .select('*')
        .single();

      if (updateErr) throw updateErr;

      return sendSuccess(res, {
        user: updatedUser,
        isNew: false
      });
    }

    // 3. New user registration
    let referrerId = null;
    if (startParam && typeof startParam === 'string' && startParam.startsWith('ref_')) {
      const parsedRef = parseInt(startParam.replace('ref_', ''), 10);
      if (parsedRef && !isNaN(parsedRef) && parsedRef !== tgUser.id) {
        // Verify referrer exists and is active
        const { data: refUser } = await supabase
          .from('users')
          .select('id, status')
          .eq('id', parsedRef)
          .single();

        if (refUser && refUser.status === 'ACTIVE') {
          referrerId = refUser.id;
        }
      }
    }

    // Insert new user record
    const { data: newUser, error: insertErr } = await supabase
      .from('users')
      .insert([
        {
          id: tgUser.id,
          username: tgUser.username || null,
          first_name: tgUser.first_name || 'User',
          balance: 0.0000,
          total_earned: 0.0000,
          referred_by: referrerId,
          status: 'ACTIVE',
          last_seen_at: new Date().toISOString()
        }
      ])
      .select('*')
      .single();

    if (insertErr) throw insertErr;

    // Create permanent referral record if applicable
    if (referrerId) {
      await supabase.from('referrals').insert([
        {
          referrer_id: referrerId,
          referred_id: tgUser.id
        }
      ]);
    }

    return sendSuccess(res, {
      user: newUser,
      isNew: true
    }, 201);
  } catch (error) {
    console.error('[Telegram Auth Error]:', error);
    return sendError(res, error.message || 'Authentication error', 500);
  }
};
