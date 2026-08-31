const tg = window.Telegram?.WebApp;
let authUser = null;
let currentShortCode = null;
let currentSession = null;
let currentStep = 1;
window.visitorLinkCode = null;

const BOT_USERNAME = 'myfileshareskbot';
const APP_SHORT_NAME = 'teleshort';

if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#0f172a');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0f172a');
  } catch (e) {
    console.warn('[Telegram SDK Setup]:', e.message);
  }
}

async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (tg?.initData) headers['x-telegram-init-data'] = tg.initData;

  const options = { method, headers };
  if (body) {
    const payload = typeof body === 'object' ? { ...body } : {};
    if (tg?.initData && !payload.initData) payload.initData = tg.initData;
    options.body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(endpoint, options);
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (_) {
      const snippet = raw.replace(/\s+/g, ' ').slice(0, 180);
      return {
        success: false,
        error: `Server returned non-JSON (HTTP ${response.status}). ${snippet || 'Empty response.'}`,
        status: response.status
      };
    }

    if (!data || typeof data !== 'object') {
      return { success: false, error: `Invalid API response (HTTP ${response.status})`, status: response.status };
    }
    if (!response.ok && !data.error) {
      data.error = `HTTP ${response.status}: ${response.statusText}`;
    }
    return data;
  } catch (networkErr) {
    return { success: false, error: `Network error: ${networkErr.message || 'Please check your internet connection.'}` };
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => safeAlert(successMsg)).catch(() => fallbackCopy(text, successMsg));
  } else fallbackCopy(text, successMsg);
}
function fallbackCopy(text, successMsg) {
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  try { document.execCommand('copy'); safeAlert(successMsg); }
  catch (e) { alert('Copy failed. Please manually copy: ' + text); }
  document.body.removeChild(el);
}
function safeAlert(msg) { if (tg?.showAlert) tg.showAlert(msg); else alert(msg); }
function triggerHaptic(type = 'impact', style = 'medium') {
  try {
    if (tg?.HapticFeedback) {
      if (type === 'impact') tg.HapticFeedback.impactOccurred(style);
      if (type === 'notification') tg.HapticFeedback.notificationOccurred(style);
    }
  } catch (e) {}
}

function buildTelegramVisitorLink(shortCode) {
  const cleanCode = String(shortCode || '').replace(/^link_/, '').trim();
  if (APP_SHORT_NAME && APP_SHORT_NAME.toLowerCase() !== BOT_USERNAME.toLowerCase()) {
    return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${cleanCode}`;
  }
  return `https://t.me/${BOT_USERNAME}?startapp=link_${cleanCode}`;
}

function getTelegramStartParam() {
  if (tg?.initDataUnsafe?.start_param) return String(tg.initDataUnsafe.start_param).trim();
  const urlParams = new URLSearchParams(window.location.search);
  for (const param of ['tgWebAppStartParam', 'startapp', 'start_param', 'start', 'link']) {
    const val = urlParams.get(param);
    if (val && typeof val === 'string' && val.trim()) return decodeURIComponent(val).trim();
  }
  return null;
}

async function initApp() {
  const loadingEl = document.getElementById('ui-loading');
  const nonTgEl = document.getElementById('ui-non-telegram');
  const mainAppEl = document.getElementById('ui-main-app');

  if (!tg || !tg.initData) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (nonTgEl) nonTgEl.classList.remove('hidden');
    return;
  }

  const rawStartParam = getTelegramStartParam();
  let visitorShortCode = null;
  if (rawStartParam && !rawStartParam.startsWith('ref_')) {
    const candidateCode = rawStartParam.replace(/^link_/, '').trim();
    if (/^[a-zA-Z0-9_-]{3,32}$/.test(candidateCode)) {
      visitorShortCode = candidateCode;
      window.visitorLinkCode = candidateCode;
      currentShortCode = candidateCode;
    }
  }

  try {
    const authPayload = { initData: tg.initData };
    if (rawStartParam && rawStartParam.startsWith('ref_')) authPayload.startParam = rawStartParam;
    const authRes = await apiCall('/api/auth/telegram', 'POST', authPayload);
    if (!authRes.success || !authRes.user) throw new Error(authRes.error || 'Authentication failed');

    authUser = authRes.user;
    updateUserUi(authUser);
    if (visitorShortCode) {
      await startVisitorFlow(visitorShortCode);
      return;
    }

    if (loadingEl) loadingEl.classList.add('hidden');
    if (mainAppEl) mainAppEl.classList.remove('hidden');
    setupNavigation();
    setupLinkShortener();
    setupWallet();
    loadDashboardData();
    loadDailyReport();
  } catch (err) {
    console.error('[Init Error]:', err);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.innerHTML = `<span class="text-red-400 font-semibold">Error: ${escapeHtml(err.message)}</span><br><button onclick="location.reload()" class="mt-3 px-4 py-1.5 bg-slate-800 text-indigo-400 rounded-lg text-xs font-bold border border-slate-700">Retry</button>`;
    }
  }
}

// The remainder of the original production frontend is intentionally preserved by this patch.
// This compatibility block is appended only if the deployment already exposes the remaining functions.
