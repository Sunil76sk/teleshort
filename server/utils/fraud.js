/**
 * TeleShort v2.1 — Fraud Evaluation Engine Foundation (Phase 4)
 * Evaluates visitor traffic telemetry and scores sessions (0-100) before ad initialization.
 */

const { getSupabaseClient } = require('./db');

/**
 * Fraud classification thresholds
 */
const FRAUD_THRESHOLDS = {
  NORMAL: 20,       // 0–20: Standard legitimate traffic
  SUSPICIOUS: 50,   // 21–50: Flagged for monitoring
  HIGH_RISK: 80,    // 51–80: Hold rewards for admin review
  CRITICAL: 100     // 81–100: Freeze rewards and account
};

/**
 * Evaluate visitor request against fraud heuristics
 * @param {object} context
 * @param {number} context.ownerId - Link owner Telegram ID
 * @param {number} context.visitorId - Visitor Telegram ID
 * @param {string} context.linkId - Link UUID
 * @param {string} context.ipHash - SHA256 hash of client IP
 * @param {string} context.userAgent - Client User-Agent header
 * @param {number} context.recentRequestsCount - Recent requests in 1-minute sliding window
 * @returns {Promise<{ score: number, status: string, isEligible: boolean, reason: string | null, flags: string[] }>}
 */
async function evaluateVisitorFraud(context) {
  const {
    ownerId,
    visitorId,
    linkId,
    ipHash,
    userAgent,
    recentRequestsCount = 1
  } = context;

  let score = 0;
  let isEligible = true;
  let reason = null;
  const flags = [];

  // 1. Self-Click Detection
  if (ownerId && visitorId && String(ownerId) === String(visitorId)) {
    isEligible = false;
    reason = 'SELF_CLICK';
    flags.push('SELF_CLICK');
    // Note: Self-click does not penalize score maliciously, just zero-rewards
  }

  // 2. User-Agent Hygiene
  if (!userAgent || userAgent.length < 10 || /curl|wget|python|postman|insomnia|headless/i.test(userAgent)) {
    score += 25;
    flags.push('SUSPICIOUS_USER_AGENT');
  }

  // 3. Velocity Checks
  if (recentRequestsCount > 15) {
    score += 30;
    flags.push('HIGH_REQUEST_VELOCITY');
  } else if (recentRequestsCount > 8) {
    score += 15;
    flags.push('MODERATE_REQUEST_VELOCITY');
  }

  // 4. Duplicate / Cooldown Check via Database (within last 24 hours)
  if (visitorId && linkId && isEligible) {
    try {
      const supabase = getSupabaseClient();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: recentClicks, error } = await supabase
        .from('clicks')
        .select('id, is_eligible, created_at')
        .eq('link_id', linkId)
        .eq('visitor_telegram_id', visitorId)
        .gte('created_at', oneDayAgo)
        .limit(1);

      if (!error && recentClicks && recentClicks.length > 0) {
        isEligible = false;
        reason = 'DUPLICATE_CLICK';
        flags.push('24H_COOLDOWN_ACTIVE');
        score += 10;
      }
    } catch (e) {
      console.warn('[Fraud Dedup Check Error]:', e.message);
    }
  }

  // Cap score between 0 and 100
  score = Math.min(100, Math.max(0, score));

  // Determine Fraud Status
  let status = 'NORMAL';
  if (score > FRAUD_THRESHOLDS.HIGH_RISK) {
    status = 'CRITICAL';
    isEligible = false;
    if (!reason) reason = 'CRITICAL_FRAUD_SCORE';
  } else if (score > FRAUD_THRESHOLDS.SUSPICIOUS) {
    status = 'HIGH_RISK';
    isEligible = false;
    if (!reason) reason = 'HIGH_RISK_TRAFFIC';
  } else if (score > FRAUD_THRESHOLDS.NORMAL) {
    status = 'SUSPICIOUS';
  }

  return {
    score,
    status,
    isEligible,
    reason,
    flags
  };
}

module.exports = {
  FRAUD_THRESHOLDS,
  evaluateVisitorFraud
};
