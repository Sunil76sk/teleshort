/**
 * TeleShort v2.1 — Admin Dashboard Analytics Endpoint (Phase 8)
 * GET /api/admin/dashboard
 * Computes server-side platform metrics across Users, Links, Traffic, Ads Funnel, Financials, and Fraud.
 */

const { handleCors, sendSuccess, sendError } = require('../utils/response');
const { authenticateAdmin } = require('../utils/auth');
const { getSupabaseClient } = require('../utils/db');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'GET') {
    return sendError(res, 'Method Not Allowed', 405);
  }

  // 1. Authenticate Admin (All roles can access dashboard)
  const auth = authenticateAdmin(req, ['SUPER_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN', 'ANALYTICS_ADMIN']);
  if (!auth.authenticated || !auth.admin) {
    return sendError(res, auth.error || 'Admin authentication required', 401, 'UNAUTHORIZED');
  }

  try {
    const supabase = getSupabaseClient();
    const range = req.query?.range || '7d';

    // 2. Parse Date Ranges (Server-Side Validation)
    const now = new Date();
    let startDate = new Date();

    if (range === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (range === 'yesterday') {
      startDate.setDate(now.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
    } else if (range === '7d') {
      startDate.setDate(now.getDate() - 7);
    } else if (range === '30d') {
      startDate.setDate(now.getDate() - 30);
    } else if (range === 'custom') {
      const from = req.query?.from;
      if (from && !isNaN(Date.parse(from))) {
        startDate = new Date(from);
      } else {
        startDate.setDate(now.getDate() - 7);
      }
    } else {
      startDate.setDate(now.getDate() - 7);
    }

    const startDateIso = startDate.toISOString();

    // 3. User Metrics
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: newUsersRange } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', startDateIso);
    const { count: activeUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');

    // 4. Link Metrics
    const { count: totalLinks } = await supabase.from('links').select('*', { count: 'exact', head: true });
    const { count: activeLinks } = await supabase.from('links').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE');
    const { count: disabledLinks } = await supabase.from('links').select('*', { count: 'exact', head: true }).eq('status', 'DISABLED');
    const { count: flaggedLinks } = await supabase.from('links').select('*', { count: 'exact', head: true }).eq('status', 'FLAGGED');

    // 5. Traffic Metrics
    const { count: totalClicks } = await supabase.from('clicks').select('*', { count: 'exact', head: true }).gte('created_at', startDateIso);
    const { count: uniqueClicks } = await supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('is_unique', true).gte('created_at', startDateIso);
    const { count: eligibleClicks } = await supabase.from('clicks').select('*', { count: 'exact', head: true }).eq('is_eligible', true).gte('created_at', startDateIso);

    // 6. Ad Funnel Metrics (from ad_events and ad_sessions)
    const { count: totalSessions } = await supabase.from('ad_sessions').select('*', { count: 'exact', head: true }).gte('created_at', startDateIso);
    const { count: ad1Completed } = await supabase.from('ad_events').select('*', { count: 'exact', head: true }).eq('step', 1).eq('event_type', 'AD_COMPLETED').gte('created_at', startDateIso);
    const { count: ad2Completed } = await supabase.from('ad_events').select('*', { count: 'exact', head: true }).eq('step', 2).eq('event_type', 'AD_COMPLETED').gte('created_at', startDateIso);
    const { count: rewardEligible } = await supabase.from('ad_sessions').select('*', { count: 'exact', head: true }).in('status', ['REWARD_ELIGIBLE', 'REWARD_CLAIMED', 'UNLOCKED']).gte('created_at', startDateIso);
    const { count: failedSessions } = await supabase.from('ad_events').select('*', { count: 'exact', head: true }).eq('event_type', 'AD_FAILED').gte('created_at', startDateIso);

    const ad1Rate = totalSessions > 0 ? parseFloat(((ad1Completed / totalSessions) * 100).toFixed(1)) : 0;
    const ad2Rate = ad1Completed > 0 ? parseFloat(((ad2Completed / ad1Completed) * 100).toFixed(1)) : 0;
    const overallCompletionRate = totalSessions > 0 ? parseFloat(((rewardEligible / totalSessions) * 100).toFixed(1)) : 0;

    // 7. Financial Metrics (from wallet_transactions and withdrawals)
    const { data: creatorTx } = await supabase.from('wallet_transactions').select('amount').eq('type', 'AD_REWARD');
    const { data: referralTx } = await supabase.from('wallet_transactions').select('amount').eq('type', 'REFERRAL_REWARD');
    
    let totalCreatorRewards = 0.0000;
    (creatorTx || []).forEach(tx => { totalCreatorRewards += parseFloat(tx.amount || 0); });

    let totalReferralRewards = 0.0000;
    (referralTx || []).forEach(tx => { totalReferralRewards += parseFloat(tx.amount || 0); });

    // Withdrawals breakdown
    const { data: pendingW } = await supabase.from('withdrawals').select('amount').in('status', ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING']);
    const { data: paidW } = await supabase.from('withdrawals').select('amount').eq('status', 'PAID');
    const { data: rejectedW } = await supabase.from('withdrawals').select('amount').in('status', ['REJECTED', 'CANCELLED']);

    let pendingWithdrawalsAmount = 0.00;
    (pendingW || []).forEach(w => { pendingWithdrawalsAmount += parseFloat(w.amount || 0); });

    let paidWithdrawalsAmount = 0.00;
    (paidW || []).forEach(w => { paidWithdrawalsAmount += parseFloat(w.amount || 0); });

    let rejectedWithdrawalsAmount = 0.00;
    (rejectedW || []).forEach(w => { rejectedWithdrawalsAmount += parseFloat(w.amount || 0); });

    // 8. Fraud Metrics
    const { count: fraudCountTotal } = await supabase.from('fraud_events').select('*', { count: 'exact', head: true }).gte('created_at', startDateIso);
    const { count: criticalFraudCount } = await supabase.from('fraud_events').select('*', { count: 'exact', head: true }).gte('score_delta', 30).gte('created_at', startDateIso);

    return sendSuccess(res, {
      range,
      period_start: startDateIso,
      users: {
        total: totalUsers || 0,
        new_in_period: newUsersRange || 0,
        active: activeUsers || 0
      },
      links: {
        total: totalLinks || 0,
        active: activeLinks || 0,
        disabled: disabledLinks || 0,
        flagged: flaggedLinks || 0
      },
      traffic: {
        total_clicks: totalClicks || 0,
        unique_clicks: uniqueClicks || 0,
        eligible_clicks: eligibleClicks || 0
      },
      ad_funnel: {
        total_sessions: totalSessions || 0,
        step_1_completed: ad1Completed || 0,
        step_1_completion_rate: `${ad1Rate}%`,
        step_2_completed: ad2Completed || 0,
        step_2_completion_rate: `${ad2Rate}%`,
        reward_eligible_sessions: rewardEligible || 0,
        overall_completion_rate: `${overallCompletionRate}%`,
        failed_sessions: failedSessions || 0
      },
      financial: {
        total_creator_rewards_inr: parseFloat(totalCreatorRewards.toFixed(4)),
        total_referral_rewards_inr: parseFloat(totalReferralRewards.toFixed(4)),
        pending_withdrawals_inr: parseFloat(pendingWithdrawalsAmount.toFixed(2)),
        paid_withdrawals_inr: parseFloat(paidWithdrawalsAmount.toFixed(2)),
        rejected_withdrawals_inr: parseFloat(rejectedWithdrawalsAmount.toFixed(2)),
        currency: 'INR',
        note: 'Calculations reflect TeleShort platform payouts. Third-party ad network revenue is tracked separately.'
      },
      fraud: {
        total_events: fraudCountTotal || 0,
        critical_events: criticalFraudCount || 0
      }
    });
  } catch (error) {
    console.error('[Admin Dashboard Error]:', error);
    return sendError(res, error.message || 'Error generating dashboard metrics', 500);
  }
};
