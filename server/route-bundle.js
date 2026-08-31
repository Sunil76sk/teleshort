/**
 * Vercel bundling manifest for the single gateway function.
 *
 * api/index.js intentionally lazy-loads route handlers with dynamic require().
 * Vercel's Node file tracer cannot reliably discover those dynamic paths, so
 * this file provides static CommonJS references for every creator/visitor route.
 * The handlers are still loaded lazily by api/index.js at request time; this
 * manifest only makes their files and transitive npm dependencies part of the
 * deployment bundle.
 */

require('./auth/telegram');
require('./links/index');
require('./links/[id]');
require('./visitor/resolve');
require('./visitor/force-join');
require('./visitor/session-start');
require('./ad-session/start');
require('./ad-session/event');
require('./ad-session/status');
require('./reward/claim');
require('./wallet/index');
require('./wallet/transactions');
require('./withdrawals/index');
require('./withdrawals/[id]');

module.exports = true;
