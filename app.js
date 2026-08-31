/* TeleShort frontend launcher - main app only */
const tg = window.Telegram?.WebApp;
const BOT_USERNAME = 'myfileshareskbot';

if (tg) {
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#0f172a');
    tg.setBackgroundColor?.('#0f172a');
  } catch (_) {}
}

async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (tg?.initData) headers['x-telegram-init-data'] = tg.initData;
  const options = { method, headers };
  if (body !== null) {
    const payload = { ...(typeof body === 'object' ? body : {}) };
    if (tg?.initData && !payload.initData) payload.initData = tg.initData;
    options.body = JSON.stringify(payload);
  }
  try {
    const response = await fetch(endpoint, options);
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch (_) {
      return { success:false, error:`Server returned non-JSON (HTTP ${response.status}).` };
    }
    if (!data || typeof data !== 'object') return { success:false, error:`Invalid API response (HTTP ${response.status}).` };
    return data;
  } catch (error) {
    return { success:false, error:`Network error: ${error.message || 'Request failed'}` };
  }
}

function showInitError(message) {
  const loading = document.getElementById('ui-loading');
  if (!loading) return;
  const text = document.getElementById('loading-text');
  if (text) text.innerHTML = `<span class="text-red-400 font-semibold">Error: ${String(message).replace(/</g,'&lt;')}</span><br><button onclick="location.reload()" class="mt-3 px-4 py-1.5 bg-slate-800 text-indigo-400 rounded-lg text-xs font-bold border border-slate-700">Retry</button>`;
}

function getStartParam() {
  if (tg?.initDataUnsafe?.start_param) return String(tg.initDataUnsafe.start_param).trim();
  const p = new URLSearchParams(location.search);
  for (const key of ['tgWebAppStartParam','startapp','start_param']) {
    const value = p.get(key);
    if (value) return value.trim();
  }
  return null;
}

function updateUserUI(user) {
  const name = user?.first_name || user?.username || 'Creator';
  document.getElementById('user-greeting')?.replaceChildren(document.createTextNode(`Hello, ${name}!`));
  document.getElementById('profile-name')?.replaceChildren(document.createTextNode(name));
  document.getElementById('profile-avatar')?.replaceChildren(document.createTextNode(name.charAt(0).toUpperCase()));
  document.getElementById('profile-id')?.replaceChildren(document.createTextNode(`Telegram ID: ${user.id}`));
  const ref = document.getElementById('referral-link-display');
  if (ref) ref.textContent = `https://t.me/${BOT_USERNAME}?start=ref_${user.id}`;
}

async function initApp() {
  const loading = document.getElementById('ui-loading');
  const nonTelegram = document.getElementById('ui-non-telegram');
  const main = document.getElementById('ui-main-app');

  if (!tg?.initData) {
    loading?.classList.add('hidden');
    nonTelegram?.classList.remove('hidden');
    return;
  }

  try {
    const startParam = getStartParam();
    const auth = await apiCall('/api/auth/telegram', 'POST', {
      initData: tg.initData,
      ...(startParam?.startsWith('ref_') ? { startParam } : {})
    });

    if (!auth.success || !auth.user) throw new Error(auth.error?.message || auth.error || 'Telegram authentication failed');

    updateUserUI(auth.user);
    loading?.classList.add('hidden');
    main?.classList.remove('hidden');
    setupNavigation();
    setupLinkShortener();
    setupWallet();
    await Promise.allSettled([loadDashboardData(), loadDailyReport()]);
  } catch (error) {
    console.error('[TeleShort init]', error);
    showInitError(error.message || 'Unable to open TeleShort');
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.target)));
}
function switchPage(id) {
  document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}

async function loadDashboardData() {
  const r = await apiCall('/api/wallet');
  if (!r.success) return;
  const a = Number(r.available_balance || 0);
  const e = Number(r.total_earned || 0);
  for (const [id, value] of [
    ['header-balance',`₹${a.toFixed(2)}`],
    ['stat-avail-balance',`₹${a.toFixed(2)}`],
    ['stat-total-earned',`₹${e.toFixed(2)}`],
    ['stat-cpm','₹160.00']
  ]) document.getElementById(id)?.replaceChildren(document.createTextNode(value));
}

function setupLinkShortener() {
  const button = document.getElementById('btn-shorten');
  const input = document.getElementById('long-url-input');
  const error = document.getElementById('shorten-error');
  const result = document.getElementById('shorten-result');
  const display = document.getElementById('short-link-display');
  if (!button || !input) return;
  button.onclick = async () => {
    const url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) {
      if (error) { error.textContent = 'Please enter a valid URL starting with http:// or https://'; error.classList.remove('hidden'); }
      return;
    }
    error?.classList.add('hidden');
    button.disabled = true;
    const r = await apiCall('/api/links', 'POST', { url });
    button.disabled = false;
    if (!r.success || !r.link) {
      if (error) { error.textContent = r.error?.message || r.error || 'Failed to create short link'; error.classList.remove('hidden'); }
      return;
    }
    const shortUrl = r.link.short_url || `https://t.me/${BOT_USERNAME}?startapp=link_${r.link.short_code}`;
    if (display) display.textContent = shortUrl;
    result?.classList.remove('hidden');
    input.value = '';
  };
}

function setupWallet() {
  const button = document.getElementById('btn-submit-withdraw');
  if (!button) return;
  button.onclick = async () => {
    const method = document.getElementById('withdraw-method')?.value || 'UPI';
    const details = document.getElementById('withdraw-details')?.value.trim();
    const amount = Number(document.getElementById('withdraw-amount')?.value);
    const error = document.getElementById('withdraw-error');
    if (!details || !Number.isFinite(amount) || amount < 100) {
      if (error) { error.textContent = 'Enter valid payment details and an amount of at least ₹100.'; error.classList.remove('hidden'); }
      return;
    }
    error?.classList.add('hidden');
    const r = await apiCall('/api/withdrawals', 'POST', { amount, payment_method: method, payout_address: details });
    if (!r.success && error) { error.textContent = r.error?.message || r.error || 'Withdrawal request failed'; error.classList.remove('hidden'); }
  };
}

async function loadDailyReport() { return; }

window.TeleShort = { apiCall };
document.addEventListener('DOMContentLoaded', initApp);
