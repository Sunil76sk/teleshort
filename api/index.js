/**
 * TeleShort v2.1 — Master Serverless Gateway Router
 *
 * IMPORTANT: Route handlers are loaded lazily inside the request handler.
 * Vercel can fail the entire serverless function during module initialization
 * if an unrelated route has a dependency/import problem. Lazy loading keeps
 * /api/auth/telegram and other healthy routes available and converts handler
 * load failures into JSON errors instead of Vercel's HTML error page.
 */

const url = require('url');
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

function loadHandler(relativePath) {
  return require(relativePath);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  req.query = Object.assign({}, parsedUrl.query, req.query || {});

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && (!req.body || typeof req.body !== 'object')) {
    req.body = await parseBody(req);
  }

  try {
    // 1. Auth
    if (pathname === '/api/auth/telegram') {
      return await loadHandler('../server/auth/telegram')(req, res);
    }

    // 2. Links
    if (pathname === '/api/links') {
      return await loadHandler('../server/links/index')(req, res);
    }
    const linkMatch = pathname.match(/^\/api\/links\/([a-zA-Z0-9_-]+)$/);
    if (linkMatch) {
      req.query.id = linkMatch[1];
      return await loadHandler('../server/links/[id]')(req, res);
    }

    // 3. Visitor Resolution & Force Join
    if (pathname === '/api/visitor/resolve') {
      return await loadHandler('../server/visitor/resolve')(req, res);
    }
    if (pathname === '/api/visitor/force-join') {
      return await loadHandler('../server/visitor/force-join')(req, res);
    }
    if (pathname === '/api/visitor/session-start') {
      return await loadHandler('../server/visitor/session-start')(req, res);
    }

    // 4. Ad Sessions (Monetag 2-Step)
    if (pathname === '/api/ad-session/start') {
      return await loadHandler('../server/ad-session/start')(req, res);
    }
    if (pathname === '/api/ad-session/event') {
      return await loadHandler('../server/ad-session/event')(req, res);
    }
    if (pathname === '/api/ad-session/status') {
      return await loadHandler('../server/ad-session/status')(req, res);
    }

    // 5. Reward Claim
    if (pathname === '/api/reward/claim') {
      return await loadHandler('../server/reward/claim')(req, res);
    }

    // 6. Wallet & Transactions
    if (pathname === '/api/wallet') {
      return await loadHandler('../server/wallet/index')(req, res);
    }
    if (pathname === '/api/wallet/transactions') {
      return await loadHandler('../server/wallet/transactions')(req, res);
    }

    // 7. Withdrawals
    if (pathname === '/api/withdrawals') {
      return await loadHandler('../server/withdrawals/index')(req, res);
    }
    const withdrawalMatch = pathname.match(/^\/api\/withdrawals\/([a-zA-Z0-9_-]+)$/);
    if (withdrawalMatch) {
      req.query.id = withdrawalMatch[1];
      return await loadHandler('../server/withdrawals/[id]')(req, res);
    }

    // 8. Admin Routes
    if (pathname === '/api/admin/auth') {
      return await loadHandler('../server/admin/auth')(req, res);
    }
    if (pathname === '/api/admin/dashboard') {
      return await loadHandler('../server/admin/dashboard')(req, res);
    }
    if (pathname === '/api/admin/settings') {
      return await loadHandler('../server/admin/settings')(req, res);
    }
    if (pathname === '/api/admin/users') {
      return await loadHandler('../server/admin/users/index')(req, res);
    }
    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([a-zA-Z0-9_-]+)$/);
    if (adminUserMatch) {
      req.query.id = adminUserMatch[1];
      return await loadHandler('../server/admin/users/[id]')(req, res);
    }
    if (pathname === '/api/admin/links') {
      return await loadHandler('../server/admin/links/index')(req, res);
    }
    const adminLinkMatch = pathname.match(/^\/api\/admin\/links\/([a-zA-Z0-9_-]+)$/);
    if (adminLinkMatch) {
      req.query.id = adminLinkMatch[1];
      return await loadHandler('../server/admin/links/[id]')(req, res);
    }
    if (pathname === '/api/admin/withdrawals') {
      return await loadHandler('../server/admin/withdrawals/index')(req, res);
    }
    const adminWithdrawalDecisionMatch = pathname.match(/^\/api\/admin\/withdrawals\/([a-zA-Z0-9_-]+)\/decision$/);
    if (adminWithdrawalDecisionMatch) {
      req.query.id = adminWithdrawalDecisionMatch[1];
      return await loadHandler('../server/admin/withdrawals/[id]/decision')(req, res);
    }
    if (pathname === '/api/admin/fraud') {
      return await loadHandler('../server/admin/fraud/index')(req, res);
    }
    if (pathname === '/api/admin/force-join') {
      return await loadHandler('../server/admin/force-join/index')(req, res);
    }
    if (pathname === '/api/admin/broadcasts') {
      return await loadHandler('../server/admin/broadcasts/index')(req, res);
    }
    const adminBroadcastSendMatch = pathname.match(/^\/api\/admin\/broadcasts\/([a-zA-Z0-9_-]+)\/send$/);
    if (adminBroadcastSendMatch) {
      req.query.id = adminBroadcastSendMatch[1];
      return await loadHandler('../server/admin/broadcasts/[id]/send')(req, res);
    }
    const adminBroadcastCancelMatch = pathname.match(/^\/api\/admin\/broadcasts\/([a-zA-Z0-9_-]+)\/cancel$/);
    if (adminBroadcastCancelMatch) {
      req.query.id = adminBroadcastCancelMatch[1];
      return await loadHandler('../server/admin/broadcasts/[id]/cancel')(req, res);
    }
    if (pathname === '/api/admin/audit-logs') {
      return await loadHandler('../server/admin/audit-logs/index')(req, res);
    }

    return sendError(res, `API route not found: ${req.method} ${pathname}`, 404, 'NOT_FOUND');
  } catch (error) {
    console.error('[Router Exception]:', error);
    return sendError(
      res,
      process.env.NODE_ENV === 'production' ? 'Internal Server Error' : (error.message || 'Internal Server Error'),
      500,
      'INTERNAL_SERVER_ERROR'
    );
  }
};
