/**
 * TeleShort v2.1 — Financial Reward Claim Endpoint (Phase 6)
 * POST /api/reward/claim
 * Server-side final eligibility verification, atomic database ledger execution,
 * referral commission calculation, and destination URL unlocking.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { verifyTelegramWebAppData } = require('../utils/auth');
const { getClientIp, hashIp } = require('../utils/crypto');
const { checkRateLimit } = require('../utils/ratelimit');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  const { session_id, initData } = req.body || {};
  if (!session_id) {
    return sendError(res, 'Session ID is required', 400, 'MISSING_SESSION_ID');
  }

  // 1. Authenticate Telegram Visitor
  const botToken = process.env.BOT_TOKEN;
  const auth = verifyTelegramWebAppData(initData, botToken);
  if (!auth.valid || !auth.user) {
    return sendError(res, auth.error || 'Invalid Telegram authentication signature', 401, 'INVALID_AUTH');
  }

  const visitorId = auth.user.id;
  const clientIp = getClientIp(req);
  const ipHash = hashIp(clientIp);

  // Rate limit claim requests (max 10 claims per minute per visitor)
  const rateLimit = await checkRateLimit(`claim_${visitorId}`, 'reward_claim', 10, 60);
  if (!rateLimit.allowed) {
    return sendError(res, 'Too many reward claim attempts. Please wait.', 429, 'RATE_LIMITED');
  }

  try {
    const supabase = getSupabaseClient();
    const now = Date.now();

    // 2. Fetch Ad Session and Link Record
    const { data: session, error: sessionErr } = await supabase
      .from('ad_sessions')
      .select('id, link_id, visitor_telegram_id, step, status, started_at, expires_at, metadata, links(id, short_code, owner_id, original_url, status)')
      .eq('id', session_id)
      .single();

    if (sessionErr || !session) {
      return sendError(res, 'Ad session not found', 404, 'SESSION_NOT_FOUND');
    }

    const link = session.links;
    if (!link) {
      return sendError(res, 'Associated link not found', 404, 'LINK_NOT_FOUND');
    }

    // Security Check: Verify session belongs to authenticated visitor
    if (String(session.visitor_telegram_id) !== String(visitorId)) {
      return sendError(res, 'Unauthorized: session belongs to another user', 403, 'UNAUTHORIZED_SESSION');
    }

    // 3. Idempotency Check: Has this session already been claimed?
    if (session.status === 'REWARD_CLAIMED' || session.status === 'UNLOCKED') {
      // Check existing transaction in ledger to return immutable record
      const { data: existingTx } = await supabase
        .from('wallet_transactions')
        .select('id, amount, currency, created_at')
        .eq('reference_type', 'AD_REWARD')
        .eq('reference_id', session.id)
        .single();

      return sendSuccess(res, {
        success: true,
        session_id: session.id,
        reward_amount: existingTx ? parseFloat(existingTx.amount) : 0.0000,
        currency: existingTx ? existingTx.currency : 'INR',
        transaction_id: existingTx?.id || null,
        owner_id: link.owner_id,
        is_owner: String(link.owner_id) === String(visitorId),
        destination_url: link.original_url,
        unlocked: true,
        idempotent_replay: true
      });
    }

    // 4. State Machine Validation: Session must be in REWARD_ELIGIBLE state
    if (session.status !== 'REWARD_ELIGIBLE') {
      return sendError(res, `Cannot claim reward. Current session status is ${session.status}`, 400, 'INVALID_SESSION_STATE');
    }

    // 5. Expiration Check
    if (new Date(session.expires_at).getTime() < now) {
      await supabase.from('ad_sessions').update({ status: 'EXPIRED' }).eq('id', session_id);
      return sendError(res, 'Ad session has expired. Please restart.', 410, 'SESSION_EXPIRED');
    }

    // 6. Link Status Check
    if (link.status !== 'ACTIVE') {
      return sendError(res, `Link is ${link.status.toLowerCase()} and cannot be claimed`, 403, 'LINK_INACTIVE');
    }

    // 7. Self-Click & Ineligibility Handling (Unlock destination with ZERO financial credit)
    const isOwner = (String(link.owner_id) === String(visitorId)) || Boolean(session.metadata?.is_owner);
    const isEligible = Boolean(session.metadata?.is_eligible) && !isOwner;

    if (!isEligible || isOwner) {
      // Mark session as unlocked without modifying wallet balances
      await supabase
        .from('ad_sessions')
        .update({
          status: 'UNLOCKED',
          completed_at: new Date(now).toISOString()
        })
        .eq('id', session_id);

      // Record in clicks table as ineligible
      await supabase.from('clicks').insert([
        {
          link_id: link.id,
          visitor_telegram_id: visitorId,
          ip_hash: ipHash,
          is_unique: true,
          is_eligible: false,
          reward_amount: 0.0000,
          fraud_score: session.metadata?.fraud_score || 0
        }
      ]);

      return sendSuccess(res, {
        success: true,
        session_id: session.id,
        reward_amount: 0.0000,
        currency: 'INR',
        owner_id: link.owner_id,
        is_owner: isOwner,
        is_eligible: false,
        ineligible_reason: session.metadata?.ineligible_reason || (isOwner ? 'SELF_CLICK' : 'FRAUD_HEURISTIC'),
        destination_url: link.original_url,
        unlocked: true
      });
    }

    // 8. Server-Side Reward & Referral Calculation (Never trust client input)
    const { data: settingsList } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', ['publisher_payout_cpm', 'referral_config']);

    const settingsMap = {};
    (settingsList || []).forEach(s => { settingsMap[s.key] = s.value; });

    // Internal Publisher Payout CPM configuration (Default: ₹160.00 INR per 1000 views = ₹0.1600 per monetized view)
    const cpmConfig = settingsMap['publisher_payout_cpm'] || { rate_inr: 160.00 };
    const rewardAmount = parseFloat((cpmConfig.rate_inr / 1000).toFixed(4)); // 0.1600 INR

    // Referral Commission Percentage (Default: 10%)
    const refConfig = settingsMap['referral_config'] || { commission_percent: 10 };
    const referralPercent = parseInt(refConfig.commission_percent, 10) || 10;

    const fraudScore = parseInt(session.metadata?.fraud_score, 10) || 0;

    // 9. Execute Atomic Stored Procedure (SECURITY DEFINER)
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('record_reward_claim', {
      p_session_id: session.id,
      p_link_id: link.id,
      p_owner_id: link.owner_id,
      p_reward_amount: rewardAmount,
      p_referral_percent: referralPercent,
      p_visitor_tg_id: visitorId,
      p_ip_hash: ipHash,
      p_fraud_score: fraudScore
    });

    if (rpcErr) {
      // Check if duplicate claim error
      if (rpcErr.message && rpcErr.message.includes('DUPLICATE_CLAIM')) {
        return sendSuccess(res, {
          success: true,
          session_id: session.id,
          reward_amount: rewardAmount,
          destination_url: link.original_url,
          unlocked: true,
          idempotent_replay: true
        });
      }
      throw rpcErr;
    }

    // 10. Audit Logging
    await supabase.from('audit_logs').insert([
      {
        actor_type: 'SYSTEM',
        actor_id: String(visitorId),
        action: 'REWARD_CLAIM_SUCCESS',
        target_type: 'WALLET_TRANSACTION',
        target_id: session.id,
        metadata: {
          link_id: link.id,
          owner_id: link.owner_id,
          visitor_id: visitorId,
          reward_amount: rewardAmount,
          referral_commission: rpcResult?.referral_commission || 0.0000
        }
      }
    ]);

    // 11. Return Destination URL & Result (Destination unlocked only after successful ledger write)
    return sendSuccess(res, {
      success: true,
      session_id: session.id,
      reward_amount: rewardAmount,
      currency: 'INR',
      owner_id: link.owner_id,
      owner_new_balance: rpcResult?.owner_new_balance,
      referral_credited: Boolean(rpcResult?.referral_commission > 0),
      referral_commission: rpcResult?.referral_commission || 0.0000,
      destination_url: link.original_url,
      unlocked: true
    });
  } catch (error) {
    console.error('[Reward Claim Error]:', error);
    return sendError(res, error.message || 'Error processing reward claim', 500);
  }
};
