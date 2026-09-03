/** Phase 1 — Security Foundation static regression checks. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const auth = fs.readFileSync(path.join(root, 'server', 'utils', 'auth.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'server', 'utils', 'db.js'), 'utf8');
const rateLimit = fs.readFileSync(path.join(root, 'server', 'utils', 'ratelimit.js'), 'utf8');
const adminAuth = fs.readFileSync(path.join(root, 'server', 'admin', 'auth.js'), 'utf8');
const audit = fs.readFileSync(path.join(root, 'server', 'utils', 'audit.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', 'phase1_security_foundation.sql'), 'utf8');
const databaseSql = fs.readFileSync(path.join(root, 'database.sql'), 'utf8');

// Telegram Mini App authentication: signature + freshness + Telegram user validation.
assert.match(auth, /verifyTelegramWebAppData/);
assert.match(auth, /Missing Telegram authentication signature/);
assert.match(auth, /Telegram auth_date is missing or invalid/);
assert.match(auth, /initData has expired/);
assert.match(auth, /authDate > nowSeconds \+ 60/);
assert.match(auth, /timingSafeEqual/);
assert.match(auth, /Telegram user data is missing or invalid/);

// Server DB access must never fall back to the public anon key.
assert.match(db, /SUPABASE_SECRET_KEY/);
assert.match(db, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(db, /Server-side APIs must use a secret\/service key/);
assert.doesNotMatch(db, /SUPABASE_ANON_KEY\s*\|\|/);

// Admin session security + rate limiting + audit coverage.
assert.match(auth, /HttpOnly; Secure; SameSite=Strict/);
assert.match(auth, /ADMIN_SESSION_TTL_SECONDS/);
assert.match(rateLimit, /SLIDING_WINDOW_LOG_REDIS/);
assert.match(adminAuth, /checkRateLimit\(ipHash, 'admin_login', 5, 900\)/);
assert.match(adminAuth, /ADMIN_LOGIN_FAILED/);
assert.match(adminAuth, /ADMIN_LOGIN_SUCCESS/);
assert.match(audit, /from\('audit_logs'\)/);
assert.match(audit, /never turn a valid auth\/admin response into a 500/);

// RLS/privilege hardening must remove client CRUD and permissive legacy policies.
assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM anon, authenticated/);
assert.match(migration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated/);
assert.doesNotMatch(migration, /USING\s*\(true\)\s+WITH\s+CHECK\s*\(true\)/i);
assert.doesNotMatch(databaseSql, /GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated/i);
assert.doesNotMatch(databaseSql, /CREATE POLICY "Public full access/i);

console.log('PHASE 1 SECURITY FOUNDATION: STATIC PASS');
