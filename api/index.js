/**
 * TeleShort v2.1 — Master Serverless Gateway Router
 * Consolidates all backend API routes into a single Serverless Function entrypoint
 * for Vercel Hobby plan compatibility (1 Serverless Function vs 12 limit).
 */

const url = require('url');

// Handlers
const authTelegramHandler = require('../server/auth/telegram');
const linksIndexHandler = require('../server/links/index');
const linksIdHandler = require('../server/links/[id]');
const visitorResolveHandler = require('../server/visitor/resolve');
const visitorForceJoinHandler = require('../server/visitor/force-join');
const visitorSessionStartHandler = require('../server/visitor/session-start');
const adSessionStartHandler = require('../server/ad-session/start');
const adSessionEventHandler = require('../server/ad-session/event');
const adSessionStatusHandler = require('../server/ad-session/status');
const rewardClaimHandler = require('../server/reward/claim');
const walletIndexHandler = require('../server/wallet/index');
const walletTransactionsHandler = require('../server/wallet/transactions');
const withdrawalsIndexHandler = require('../server/withdrawals/index');
const withdrawalsIdHandler = require('../server/withdrawals/[id]');

// Admin Handlers
const adminAuthHandler = require('../server/admin/auth');
const adminDashboardHandler = require('../server/admin/dashboard');
const adminSettingsHandler = require('../server/admin/settings');
const adminUsersIndexHandler = require('../server/admin/users/index');
const adminUsersIdHandler = require('../server/admin/users/[id]');
const adminLinksIndexHandler = require('../server/admin/links/index');
const adminLinksIdHandler = require('../server/admin/links/[id]');
const adminWithdrawalsIndexHandler = require('../server/admin/withdrawals/index');
const adminWithdrawalsDecisionHandler = require('../server/admin/withdrawals/[id]/decision');
const adminFraudHandler = require('../server/admin/fraud/index');
const adminForceJoinHandler = require('../server/admin/force-join/index');
const adminBroadcastsIndexHandler = require('../server/admin/broadcasts/index');
const adminBroadcastsSendHandler = require('../server/admin/broadcasts/[id]/send');
const adminBroadcastsCancelHandler = require('../server/admin/broadcasts/[id]/cancel');
const adminAuditLogsHandler = require('../server/admin/audit-logs/index');

const { handleCors, sendError } = require('../server/utils/response');

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve) => {
    let bodyStr = '';
    req.on('data', (chunk) => {
      bodyStr += chunk;
    });
    req.on('end', () => {
      try {
        if (!bodyStr) return resolve({});
        resolve(JSON.parse(bodyStr));
      } catch (e) {
        resolve({});
      }
    });
  });
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  req.query = Object.assign({}, parsedUrl.query, req.query || {});
  
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object')) {
    req.body = await parseBody(req);
  }

  // --- ROUTING TABLE ---
  try {
    // 1. Auth
    if (pathname === '/api/auth/telegram') {
      return await authTelegramHandler(req, res);
    }

    // 2. Links
    if (pathname === '/api/links') {
      return await linksIndexHandler(req, res);
    }
    const linkMatch = pathname.match(/^\/api\/links\/([a-zA-Z0-9_-]+)$/);
    if (linkMatch) {
      req.query.id = linkMatch[1];
      return await linksIdHandler(req, res);
    }

    // 3. Visitor Resolution & Force Join
    if (pathname === '/api/visitor/resolve') {
      return await visitorResolveHandler(req, res);
    }
    if (pathname === '/api/visitor/force-join') {
      return await visitorForceJoinHandler(req, res);
    }
    if (pathname === '/api/visitor/session-start') {
      return await visitorSessionStartHandler(req, res);
    }

    // 4. Ad Sessions (Monetag 2-Step)
    if (pathname === '/api/ad-session/start') {
      return await adSessionStartHandler(req, res);
    }
    if (pathname === '/api/ad-session/event') {
      return await adSessionEventHandler(req, res);
    }
    if (pathname === '/api/ad-session/status') {
      return await adSessionStatusHandler(req, res);
    }

    // 5. Reward Claim
    if (pathname === '/api/reward/claim') {
      return await rewardClaimHandler(req, res);
    }

    // 6. Wallet & Transactions
    if (pathname === '/api/wallet') {
      return await walletIndexHandler(req, res);
    }
    if (pathname === '/api/wallet/transactions') {
      return await walletTransactionsHandler(req, res);
    }

    // 7. Withdrawals
    if (pathname === '/api/withdrawals') {
      return await withdrawalsIndexHandler(req, res);
    }
    const withdrawalMatch = pathname.match(/^\/api\/withdrawals\/([a-zA-Z0-9_-]+)$/);
    if (withdrawalMatch) {
      req.query.id = withdrawalMatch[1];
      return await withdrawalsIdHandler(req, res);
    }

    // 8. Admin Routes
    if (pathname === '/api/admin/auth') {
      return await adminAuthHandler(req, res);
    }
    if (pathname === '/api/admin/dashboard') {
      return await adminDashboardHandler(req, res);
    }
    if (pathname === '/api/admin/settings') {
      return await adminSettingsHandler(req, res);
    }
    if (pathname === '/api/admin/users') {
      return await adminUsersIndexHandler(req, res);
    }
    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)$/);
    if (adminUserMatch) {
      req.query.id = adminUserMatch[1];
      return await adminUsersIdHandler(req, res);
    }
    if (pathname === '/api/admin/links') {
      return await adminLinksIndexHandler(req, res);
    }
    const adminLinkMatch = pathname.match(/^\/api\/admin\/links\/([a-zA-Z0-9_-]+)$/);
    if (adminLinkMatch) {
      req.query.id = adminLinkMatch[1];
      return await adminLinksIdHandler(req, res);
    }
    if (pathname === '/api/admin/withdrawals') {
      return await adminWithdrawalsIndexHandler(req, res);
    }
    const adminWithdrawalDecisionMatch = pathname.match(/^\/api\/admin\/withdrawals\/([a-zA-Z0-9_-]+)\/decision$/);
    if (adminWithdrawalDecisionMatch) {
      req.query.id = adminWithdrawalDecisionMatch[1];
      return await adminWithdrawalDecisionHandler(req, res);
    }
    if (pathname === '/api/admin/fraud') {
      return await adminFraudHandler(req, res);
    }
    if (pathname === '/api/admin/force-join') {
      return await adminForceJoinHandler(req, res);
    }
    if (pathname === '/api/admin/broadcasts') {
      return await adminBroadcastsIndexHandler(req, res);
    }
    const adminBroadcastSendMatch = pathname.match(/^\/api\/admin\/broadcasts\/([a-zA-Z0-9_-]+)\/send$/);
    if (adminBroadcastSendMatch) {
      req.query.id = adminBroadcastSendMatch[1];
      return await adminBroadcastsSendHandler(req, res);
    }
    const adminBroadcastCancelMatch = pathname.match(/^\/api\/admin\/broadcasts\/([a-zA-Z0-9_-]+)\/cancel$/);
    if (adminBroadcastCancelMatch) {
      req.query.id = adminBroadcastCancelMatch[1];
      return await adminBroadcastsCancelHandler(req, res);
    }
    if (pathname === '/api/admin/audit-logs') {
      return await adminAuditLogsHandler(req, res);
    }

    return sendError(res, `API route not found: ${req.method} ${pathname}`, 404, 'NOT_FOUND');
  } catch (error) {
    console.error('[Router Exception]:', error);
    return sendError(res, 'Internal Server Error', 500, 'INTERNAL_SERVER_ERROR');
  }
};
