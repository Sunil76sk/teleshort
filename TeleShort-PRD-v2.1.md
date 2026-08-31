# TeleShort — Production-Grade PRD v2.1

**Status:** Ready for implementation planning
**Baseline:** Existing TeleShort codebase (SQL, user app, admin panel, reward/referral/broadcast APIs)
**Target:** Telegram Mini App URL monetization platform
**Primary ad model:** Monetag only
**Default ad flow:** 2 ad opportunities per link
**Database:** PostgreSQL / Supabase
**Hosting:** Vercel-compatible
**Bot:** Telegram Bot + Mini App

Changelog from v2.0: AdsGram removed entirely (not beginner-friendly, higher payout floor, added complexity). Monetag is now the sole ad network. Withdrawal minimum changed from a $100 assumption to a platform-configurable threshold (recommended ₹100–₹200 for India-first launch), which is separate from Monetag's own publisher payout threshold.

---

## 1. Product Overview

TeleShort is a Telegram-native URL shortening and monetization platform.

Flow:
1. User opens the Telegram Mini App.
2. User pastes a destination URL.
3. System generates a Telegram short link.
4. User shares that link.
5. Visitor opens the short link.
6. Visitor passes required checks (Force Join, self-click, duplicate/cooldown).
7. Visitor completes 2 Monetag ad opportunities.
8. Destination URL becomes available.
9. Link owner receives an eligible earning.
10. Referral owner (if any) receives a configured commission.
11. Earnings accumulate in a wallet ledger.
12. User requests withdrawal after reaching the platform's minimum threshold.

---

## 2. Product Goals

**Primary**
- Reliable Telegram URL shortener with high-quality Mini App UX
- Monetize legitimate traffic via Monetag
- Transparent creator earnings
- Prevent fake rewards, self-clicks, and duplicate/replay rewards
- Secure wallet accounting and withdrawals
- Complete admin control

**Secondary**
- Referral growth
- Force Join
- Analytics
- Broadcast
- Fraud scoring

---

## 3. Non-Goals (v1)

- Full traditional web URL-shortener SaaS
- Automated cryptocurrency exchange
- Multi-level MLM referrals
- Guaranteed ad income promises to users
- Multiple ad network stacking/waterfall (single network only — Monetag)
- Arbitrary user-created advertisements
- Client-side financial calculations

---

## 4. Existing System Audit

Current ZIP contains: `SQL EDITER CODE.txt`, `Userappcode.txt`, `adminpanelcode.txt`, `broadcast.js`, `package.json`, `process_referral.js`, `prompts.txt`, `reward (1).js`.

Already implemented:
- Telegram WebApp UI, Supabase client, URL shortening, Telegram `startapp` links
- User dashboard, My Links, Wallet, Withdrawals, Referrals
- Admin dashboard, user blocking, withdrawal management, settings, broadcast
- Monetag script tag integration, timer-based ad flow

---

## 5. Critical Existing Problems (P0 — must fix before launch)

### P0 — Database security
RLS is currently disabled. Production must route all writes through backend APIs using the service role — never direct client → Supabase writes for financial tables.

```
Client → Backend API → Supabase service role → PostgreSQL
NOT: Client → Supabase → users.balance UPDATE
```

### P0 — Client-side wallet modification
Current withdrawal flow manipulates balance from the frontend. Replace with:
```
POST /api/withdrawals
  → authenticate Telegram user
  → validate amount
  → database transaction
  → reserve balance
  → create withdrawal
```

### P0 — Reward can be triggered from client
`reward (1).js` currently has no self-click check, no dedup, no auth — a raw `curl` can drain the wallet. Replace with a signed server-side challenge/session model (Section 16).

### P0 — Static admin password
Replace with server-side session auth + HTTP-only cookie + RBAC (Section 31).

### P0 — Broadcast authentication
`broadcast.js` must never be publicly callable. Require admin session + RBAC + rate limiting.

### P0 — Referral security
Never trust `referrer_id` from the client. Referral relationship must be created server-side from verified Telegram identity only.

---

## 6. Final Feature List

**User:** Telegram auth, home dashboard, URL shortening, short-link generation, copy/share, My Links, click stats, earnings, wallet, withdrawal + history, referral link/stats/earnings, Force Join, settings, terms, privacy, support, account status

**Visitor:** Telegram auth, short-link resolution, Force Join, fraud checks, ad session (Ad 1, Ad 2), unlock, destination redirect, invalid-link handling, self-click handling, duplicate-click handling

**Admin:** Dashboard, users, links, clicks, wallet, withdrawals, referrals, ad configuration, CPM/payout configuration, Force Join, broadcast, maintenance, fraud, analytics, audit logs, admin users, system settings

---

## 7. User Journey

```
Telegram → /start → Open Mini App → Telegram auth → Check account
  → Check Force Join → Dashboard → Paste URL → Server validates URL
  → Create short link → Return Telegram deep link → Share
```

## 8. Visitor Journey

```
Visitor clicks TeleShort link
  → Telegram Mini App
  → Validate Telegram initData
  → Load short-link
  → Check link status
  → Check banned user
  → Check Force Join
  → Check self-click
  → Check duplicate/cooldown
  → Create ad session
  → Monetag Ad #1 → completion verification
  → Monetag Ad #2 → completion verification
  → Reward transaction
  → Unlock → Open destination
```

---

## 9. UI/UX

Keep the existing visual identity — improve, don't redesign from scratch.

**Home**
```
TeleShort
Hello, Sunil 👋

Balance      $0.00
Today        $0.00
Views        0
CPM          $X.XX
────────────────────
Enter your long link
[ Paste URL ]
[ Shorten & Earn ]
────────────────────
Today's Earnings

Nav: Home | Links | Wallet | Referral | Settings
```

**Unlock page**
```
🔐 Link Unlock
Step 1 of 2
┌──────────────┐
│  Monetag Ad  │
└──────────────┘
Please wait 8s
[ Watch Ad ]
      ✓
Step 2 of 2
[ Watch Ad ]
─────────────
🔓 Link Unlocked
[ GET LINK ]
```
Rule: never show "completed" state until Monetag's actual completion callback fires.

---

## 10. Telegram Architecture

```
Telegram → Bot / Mini App → Frontend → Backend → Supabase / Redis / Telegram API
```
Telegram `initData` must be cryptographically validated server-side (HMAC-SHA256 against `BOT_TOKEN`).

```javascript
const crypto = require('crypto');
function verifyTelegramWebAppData(initDataString, botToken) {
  const urlParams = new URLSearchParams(initDataString);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');
  const params = Array.from(urlParams.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(params).digest('hex');
  return calculatedHash === hash;
}
```

---

## 11. Force Join

Admin config: toggle ON/OFF, `channel_id` (e.g. `@TeleShortOfficial`), required before **link unlock** (dashboard access and link creation stay open — don't block every interaction).

```
Open link → Check membership via getChatMember
  → Member? YES → continue
  → NO → Show "Join Channel" card → user joins → "I've Joined" → server re-verifies → continue
```

```
GET https://api.telegram.org/bot<TOKEN>/getChatMember?chat_id=@YourChannel&user_id=<visitor_id>
```
- Valid statuses to proceed: `member`, `administrator`, `creator`
- Cache result ~1 hour per user (Redis) to avoid hammering the Telegram API
- Bot must be an admin of the channel to reliably check membership

---

## 12. Monetag Integration (sole ad network)

```
Ad Opportunity #1 → Monetag format (rewarded interstitial / rewarded popup)
Ad Opportunity #2 → Monetag format (in-app interstitial)
```

Implementation:
1. Load Monetag Web SDK tag in `<head>` of `index.html`.
2. On "Watch Ad" tap → trigger Monetag's show function for the configured zone.
3. On Monetag's completion callback → submit the challenge token to `/api/reward/claim` (never trust a client timer alone).
4. Repeat for Ad #2, then unlock.

**Business logic — do not conflate network revenue with payout CPM:**
```
Network revenue (what Monetag actually pays TeleShort)
        ↓
Publisher payout CPM (what admin chooses to give creators)
        ↓
Creator reward
```
Admin configures a **Publisher Payout CPM** field — never present this as "Monetag's live CPM." Monetag's actual CPM varies by geography, device, format, and advertiser demand — do not promise users a fixed rate per 1,000 views.

---

## 13. Two-Ad Economics

Track these as distinct events, not one number:
```
Visitor clicks ≠ Ad impressions ≠ Ad completions ≠ Eligible reward
```
Example: 1,000 visitors → 2,000 theoretical ad opportunities → fewer actual impressions → fewer completions → fewer eligible rewards. Calculate earnings from **actual eligible monetization events**, never `visitors × 2 × CPM`.

---

## 14. Reward System (financial core)

Never allow "frontend timer finished = money." Use a signed session model:

```
create_ad_session → session_id → server challenge
  → Monetag ad shown → Monetag completion callback
  → server verifies completion + checks fraud rules
  → reward eligibility → atomic transaction → ledger entry
```

Each reward must have a unique, immutable ID (idempotency key) so a reward can never be credited twice, even on retry/replay.

**API: `POST /api/ads/session-start`**
```json
// Request
{ "short_code": "x9KqL2", "initData": "query_id=...&hash=..." }
// Response
{ "challenge_token": "eyJhbGciOi...", "timer_seconds": 5, "is_owner": false }
```

**API: `POST /api/reward/claim`**
```json
// Request
{ "short_code": "x9KqL2", "challenge_token": "eyJhbGciOi...", "initData": "..." }
// Response
{ "success": true, "destination_url": "https://example.com/file", "reward_credited": 0.0025 }
```
Logic: verify token signature + minimum elapsed time → self-click check (visitor_id == owner_id → 0 reward) → 24h dedup check (ip_hash/visitor_id + short_code) → if unique, credit reward + referral commission atomically.

---

## 15. Wallet Ledger

Don't rely only on `users.balance`. Add an immutable ledger table:

```
wallet_transactions
  id, user_id, type, amount, currency,
  reference_type, reference_id,
  balance_before, balance_after, status,
  created_at, metadata
```
Types: `AD_REWARD`, `REFERRAL_REWARD`, `WITHDRAWAL_RESERVE`, `WITHDRAWAL_REFUND`, `ADMIN_ADJUSTMENT`, `BONUS`, `REVERSAL`.

`users.balance` becomes a cached current value; the ledger is the accounting source of truth. Every transaction carries a unique reference so a reward/referral can never be double-credited.

---

## 16. Referral System

- One-level referral only in v1 (A refers B → A gets a configured % of B's earnings)
- Self-referral prohibited
- One permanent referrer per user, assigned only once, tied to verified Telegram ID
- Reward only after a qualifying activity — not merely for opening the app
- Suspicious referral patterns flagged (Section 19)

---

## 17. Withdrawal System

**User flow:** Wallet → available balance → check against platform minimum → choose payment method → enter payout details → submit

**Backend:** authenticate → check account status → check available balance → check pending withdrawals → reserve funds atomically → create withdrawal → ledger entry

**Admin:** Pending → Review → Approve / Reject. Rejection triggers a reversal + ledger entry + balance restored — never modify balance directly without a ledger record.

**States:** `PENDING`, `UNDER_REVIEW`, `APPROVED`, `PROCESSING`, `PAID`, `REJECTED`, `CANCELLED`

**Recommended policy for TeleShort (India-first launch):**
```
Minimum withdrawal: ₹100 (platform-configurable in Settings — keep this separate
                     from Monetag's own publisher payout threshold, which varies
                     by payment method on Monetag's side)
Processing: Manual admin review initially
```
Set this low enough that new users hit it and get paid quickly — that's what builds trust and retention early on.

---

## 18. Fraud Prevention

- **Identity:** Telegram `initData` HMAC verification on every request
- **Self-click:** visitor Telegram ID == link owner ID → no reward
- **Duplicate:** same visitor + same link + cooldown window → no second reward
- **Replay:** ad completion/challenge token usable exactly once
- **Rate limiting:** on link creation, reward sessions, reward completion, withdrawal creation, referral operations, admin APIs
- **IP/device signals:** use carefully — don't auto-ban on shared IP alone (mobile CGNAT causes legitimate collisions)

**Fraud score** (0–100): 0–20 normal (pay), 21–50 suspicious (monitor), 51–80 high risk (hold rewards), 81–100 critical (freeze + review). Signals: abnormal click frequency, repeated IP/device fingerprint, abnormal ad-completion patterns, multiple accounts, self-referral patterns, rapid withdrawals, excessive referral creation.

---

## 19. Database Schema

Core tables: `users`, `links`, `clicks`, `ad_sessions`, `wallet_transactions`, `withdrawals`, `referrals`, `force_join_channels`, `settings`, `admin_users`, `admin_sessions`, `audit_logs`, `fraud_events`, `broadcasts`, `broadcast_deliveries`.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE public.users (
  id BIGINT PRIMARY KEY, -- Telegram User ID
  username TEXT,
  first_name TEXT NOT NULL,
  balance NUMERIC(12,4) DEFAULT 0.0000 CHECK (balance >= 0),
  total_earned NUMERIC(12,4) DEFAULT 0.0000 CHECK (total_earned >= 0),
  referred_by BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, BANNED
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);
CREATE INDEX idx_users_referred_by ON public.users(referred_by);

CREATE TABLE public.links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(16) UNIQUE NOT NULL,
  owner_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  original_url TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE', -- ACTIVE, DISABLED, EXPIRED, FLAGGED
  click_count INTEGER DEFAULT 0,
  eligible_click_count INTEGER DEFAULT 0,
  total_earnings NUMERIC(12,4) DEFAULT 0.0000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_links_short_code ON public.links(short_code);
CREATE INDEX idx_links_owner_id ON public.links(owner_id);

CREATE TABLE public.clicks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  visitor_telegram_id BIGINT,
  ip_hash VARCHAR(64) NOT NULL,
  user_agent_hash TEXT,
  country VARCHAR(4),
  is_unique BOOLEAN DEFAULT TRUE,
  is_eligible BOOLEAN DEFAULT FALSE,
  reward_amount NUMERIC(10,4) DEFAULT 0.0000,
  fraud_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_clicks_link_id ON public.clicks(link_id);
CREATE INDEX idx_clicks_dedup ON public.clicks(link_id, ip_hash, created_at);

CREATE TABLE public.ad_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  visitor_telegram_id BIGINT,
  step INTEGER NOT NULL, -- 1 or 2
  status TEXT DEFAULT 'CREATED', -- CREATED, STARTED, COMPLETED, FAILED, EXPIRED, REJECTED
  challenge_hash TEXT NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB
);

CREATE TABLE public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- AD_REWARD, REFERRAL_REWARD, WITHDRAWAL_RESERVE, WITHDRAWAL_REFUND, ADMIN_ADJUSTMENT, BONUS, REVERSAL
  amount NUMERIC(12,4) NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  balance_before NUMERIC(12,4) NOT NULL,
  balance_after NUMERIC(12,4) NOT NULL,
  status TEXT DEFAULT 'COMPLETED',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB,
  UNIQUE(reference_type, reference_id)
);

CREATE TABLE public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  referred_id BIGINT UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(32) NOT NULL,
  payout_address TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING', -- PENDING, UNDER_REVIEW, APPROVED, PROCESSING, PAID, REJECTED, CANCELLED
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX idx_withdrawals_user_id ON public.withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON public.withdrawals(status);

CREATE TABLE public.force_join_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL, -- SUPER_ADMIN, FINANCE_ADMIN, SUPPORT_ADMIN, MARKETING_ADMIN, ANALYTICS_ADMIN
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL, -- ADMIN, SYSTEM
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.fraud_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT REFERENCES public.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  score_delta INTEGER NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message TEXT NOT NULL,
  image_url TEXT,
  button_text TEXT,
  button_url TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.broadcast_deliveries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  broadcast_id UUID NOT NULL REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'PENDING', -- PENDING, SENT, FAILED, BLOCKED
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
-- Block all direct client access; only backend serverless functions use the service role key
```

---

## 20. API Design

**Auth:** `POST /api/auth/telegram`

**User:** `GET /api/me`, `GET /api/settings/public`

**Links:** `POST /api/links`, `GET /api/links`, `GET /api/links/:id`, `DELETE /api/links/:id`

**Visitor:** `GET /api/links/:shortCode`, `POST /api/ad-session/start`, `POST /api/ad-session/complete`, `POST /api/reward/claim`

**Wallet:** `GET /api/wallet`, `GET /api/wallet/transactions`

**Withdrawal:** `POST /api/withdrawals`, `GET /api/withdrawals`

**Referral:** `GET /api/referrals`, `GET /api/referrals/stats`

**Admin:** `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, `GET /api/admin/dashboard`, `GET /api/admin/users`, `PATCH /api/admin/users/:id`, `GET /api/admin/links`, `GET /api/admin/withdrawals`, `POST /api/admin/withdrawals/:id/approve`, `POST /api/admin/withdrawals/:id/reject`, `GET /api/admin/fraud`, `POST /api/admin/users/:id/suspend`, `GET/PATCH /api/admin/settings`, `GET/PATCH /api/admin/ad-config`, `GET /api/admin/audit-logs`, `POST /api/admin/broadcast`

---

## 21. Admin RBAC

No single unlimited admin password. Roles: `SUPER_ADMIN`, `FINANCE_ADMIN`, `SUPPORT_ADMIN`, `MARKETING_ADMIN`, `ANALYTICS_ADMIN`.

Example — Finance admin: can view/approve/reject withdrawals; cannot change ad configuration, delete users, or change super-admin.

---

## 22. URL Safety

**Validate:** `http://`, `https://` only
**Reject:** `javascript:`, `data:`, `file:`, malformed URLs, localhost/internal addresses, known phishing/malware domains, unsupported protocols
**Production enhancement:** integrate a URL reputation API (e.g. Google Safe Browsing) before activating a link.

---

## 23. Analytics

**Admin:** total users, DAU/WAU/MAU, total links, total/unique/eligible clicks, ad starts, ad completions, completion rate, revenue, creator payouts, referral payouts, pending withdrawals, fraud rate

**User:** total views, today views, total earnings, today earnings, referral earnings, links created

---

## 24. Broadcast System

Keep the existing concept, move it fully behind authenticated admin APIs. Features: text, image, inline button, Mini App button, channel link, target all/active/selected users, delivery statistics, failed-delivery tracking, blocked-user detection, rate-controlled sending.

---

## 25. Environment Variables

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
BOT_TOKEN
BOT_USERNAME
MINI_APP_URL
MONETAG_ZONE_ID
MONETAG_CONFIG
ADMIN_SESSION_SECRET
REDIS_URL
# optional
URL_REPUTATION_API_KEY
ANALYTICS_KEY
ERROR_TRACKING_DSN
```
Never commit `.env`.

---

## 26. Deployment Architecture

```
Telegram → Bot + Mini App → Vercel (Backend APIs) → Supabase (PostgreSQL) / Redis / Telegram API
                                                            ↓
                                                    Accounting + Analytics
```

---

## 27. Development Phases

- **Phase 0 — Audit:** No code changes. Read every existing file, map dependencies, identify vulnerabilities, compare against this PRD, produce a migration report (EXISTS / MODIFY / ADD / REMOVE / SECURITY CRITICAL).
- **Phase 1 — Security Foundation:** Telegram auth, backend auth middleware, admin auth, RLS, service-role isolation, rate limiting, audit logging.
- **Phase 2 — Database Migration:** Deploy schema from Section 19 with indexes, constraints, transactions.
- **Phase 3 — URL Engine:** Server-side link creation, secure slug generation, URL validation, link status/history, Telegram deep links.
- **Phase 4 — Visitor Engine:** Deep-link recognition, visitor auth, link lookup, self-click protection, duplicate protection, fraud scoring, Force Join.
- **Phase 5 — Ads (Monetag only):** Ad session tracking for 2 opportunities per link, completion verification.
- **Phase 6 — Rewards:** Reward challenge, completion verification, idempotency, ledger, atomic transaction, creator + referral earning.
- **Phase 7 — Wallet:** Balance, transaction history, earnings, reservations, refunds, adjustments.
- **Phase 8 — Withdrawals:** ₹100 minimum threshold, payment methods, pending → review → approve/reject → refund, audit trail.
- **Phase 9 — Referral:** Deep link, permanent relationship, qualification rule, commission, fraud detection, analytics.
- **Phase 10 — Admin:** Dashboard, users, links, withdrawals, fraud, settings, ad config, Force Join, broadcast, audit logs.
- **Phase 11 — Analytics:** User, link, ad, revenue, withdrawal, fraud analytics.
- **Phase 12 — QA:** New user, existing user, blocked user, self-click, duplicate click, two users same IP, ad failure/completion, replay completion, expired session, fake Telegram ID, fake reward, double withdrawal, withdrawal race, self-referral, fake referral, malicious URL, unauthorized admin access.

---

## 28. Acceptance Criteria

- A user cannot impersonate another Telegram user.
- A user cannot create unlimited rewards by calling the API manually.
- Every financial mutation creates exactly one ledger transaction.
- Two simultaneous withdrawal requests cannot spend the same balance.
- A user cannot refer themselves.
- A creator cannot earn from their own link.
- A configured duplicate/cooldown policy prevents repeated rewards.
- Unauthenticated users cannot access admin APIs.
- Client cannot directly modify: `balance`, `total_earnings`, `wallet_transactions`, `withdrawals.status`.
- A timer finishing alone cannot create a financial reward — only a verified Monetag completion + server-side check can.

---

## 29. Existing Code — Keep / Modify / Replace

| Component | Decision |
|---|---|
| Existing UI | KEEP + improve |
| Telegram Mini App | KEEP + secure |
| Supabase | KEEP |
| Vercel | KEEP |
| URL shortener | REBUILD backend logic |
| Direct Supabase writes from client | REMOVE |
| Current reward endpoint | REPLACE |
| Current withdrawal logic | REPLACE |
| Current referral API | REPLACE |
| Static admin password | REMOVE |
| Broadcast concept | KEEP + secure |
| Monetag | KEEP + redesign integration (2-ad flow, session-verified) |
| AdsGram | **REMOVED — not in scope for v2.1** |
| Force Join | ADD |
| Wallet ledger | ADD |
| Fraud engine | ADD |
| Audit logs | ADD |
| Redis / rate limiting | ADD |

---

## 30. Instructions for Antigravity

Place this file in the project root as `PRD.md`, then give Antigravity this instruction — not "build everything":

```
Read PRD.md completely.

Do NOT modify any code yet.

First audit the entire existing TeleShort codebase.
Compare every existing file against PRD.md.

Create a detailed migration report covering:
1. Existing functionality
2. Broken functionality
3. Security vulnerabilities
4. Features to preserve
5. Features to modify
6. Features to replace
7. Features to add
8. Database migration requirements
9. API migration requirements
10. UI migration requirements
11. Deployment requirements

Pay special attention to:
- Supabase RLS
- service-role exposure
- Telegram initData validation
- reward manipulation
- withdrawal race conditions
- referral manipulation
- admin authentication
- broadcast authentication
- URL security
- rate limiting
- replay attacks
- idempotency
- wallet accounting

DO NOT WRITE CODE YET. Show me the audit and implementation plan first.
```

Once the audit comes back, approve it phase by phase (Section 27) — don't let Antigravity implement all 12 phases in one pass.
