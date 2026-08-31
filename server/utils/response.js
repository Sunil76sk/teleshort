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
  return res.status(statusCode).json({
    success: true,
    data
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
