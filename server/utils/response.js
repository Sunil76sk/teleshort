/**
 * TeleShort v2.1 — Standard API Response & CORS Utility
 */

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-telegram-init-data'
  );
}

function handleCors(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

function sendSuccess(res, data = {}, statusCode = 200) {
  setCorsHeaders(res);
  // Keep the canonical nested `data` envelope while also exposing its
  // fields at the top level for the existing production frontend client.
  return res.status(statusCode).json({
    success: true,
    data,
    ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
  });
}

function sendError(res, message = 'Internal Server Error', statusCode = 500, code = 'ERROR') {
  setCorsHeaders(res);
  return res.status(statusCode).json({
    success: false,
    error: {
      message,
      code
    }
  });
}

module.exports = {
  setCorsHeaders,
  handleCors,
  sendSuccess,
  sendError
};

// api/index.js uses dynamic require() for route selection. Keep a static
// reference in the dependency graph so Vercel bundles the route files and
// their transitive npm dependencies (including jsonwebtoken).
if (process.env.VERCEL === '1') {
  try {
    require('../route-bundle');
  } catch (error) {
    // Do not break unrelated requests at module initialization. The gateway
    // will surface the actual route/module error if that route is requested.
    console.warn('[Vercel Route Bundle Warning]:', error.message);
  }
}
