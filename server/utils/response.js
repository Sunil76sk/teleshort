/** TeleShort v2.2 — Standard API Response & CORS Utility */

function setCorsHeaders(res) {
  const configured = String(process.env.MINI_APP_URL || process.env.ADMIN_ORIGIN || '').trim();
  const allowedOrigin = configured && !configured.includes('your-app.vercel.app') ? configured.replace(/\/$/, '') : 'https://teleshort-seven.vercel.app';
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-telegram-init-data');
}

function handleCors(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') { res.status(200).end(); return true; }
  return false;
}

function sendSuccess(res, data = {}, statusCode = 200) {
  setCorsHeaders(res);
  return res.status(statusCode).json({ success: true, data, ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}) });
}

function sendError(res, message = 'Internal Server Error', statusCode = 500, code = 'ERROR') {
  setCorsHeaders(res);
  const safeMessage = typeof message === 'string' ? message : (message?.message || 'Internal Server Error');
  return res.status(statusCode).json({ success: false, error: safeMessage, error_code: code, details: { message: safeMessage, code } });
}

module.exports = { setCorsHeaders, handleCors, sendSuccess, sendError };
