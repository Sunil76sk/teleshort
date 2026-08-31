/**
 * TeleShort v2.1 — Production Telegram Mini App Frontend Engine (Phase 7A Hardened)
 * High-performance, secure client engine for Telegram URL Monetization.
 * Supports: Universal Deep-Links, 2-Step Monetag Ads, INR Financial Consistency,
 * Force Join gate, Atomic Claiming, and Immutable Wallet Accounting.
 */

// =========================================================================
// 1. STATE & TELEGRAM INITIALIZATION
// =========================================================================
const tg = window.Telegram?.WebApp;
let authUser = null;
let currentShortCode = null;
let currentSession = null;
let currentStep = 1;
window.visitorLinkCode = null;

const BOT_USERNAME = 'myfileshareskbot';
const APP_SHORT_NAME = 'teleshort'; // Configured Direct Mini App short_name or Main Mini App fallback

// Telegram WebApp Setup
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

// =========================================================================
// 2. CENTRALIZED API CLIENT & HELPERS
// =========================================================================
async function apiCall(endpoint, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (tg?.initData) {
    headers['x-telegram-init-data'] = tg.initData;
  }

  const options = {
    method,
    headers
  };

  if (body) {
    const payload = typeof body === 'object' ? { ...body } : {};
    if (tg?.initData && !payload.initData) {
      payload.initData = tg.initData;
    }
    options.body = JSON.stringify(payload);
  }

  try {
    const response = await fetch(endpoint, options);
    const data = await response.json().catch(() => ({ success: false, error: 'Invalid JSON response from server' }));

    if (!response.ok && !data.error) {
      data.error = `HTTP ${response.status}: ${response.statusText}`;
    }
    return data;
  } catch (networkErr) {
    return { success: false, error: 'Network error. Please check your internet connection.' };
  }
}

// XSS Sanitizer
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Clipboard Helper
function copyToClipboard(text, successMsg = 'Copied to clipboard!') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      safeAlert(successMsg);
    }).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const el = document.createElement('textarea');
  el.value = text;
  document.body.appendChild(el);
  el.select();
  try {
    document.execCommand('copy');
    safeAlert(successMsg);
  } catch (e) {
    alert('Copy failed. Please manually copy: ' + text);
  }
  document.body.removeChild(el);
}

function safeAlert(msg) {
  if (tg?.showAlert) {
    tg.showAlert(msg);
  } else {
    alert(msg);
  }
}

function triggerHaptic(type = 'impact', style = 'medium') {
  try {
    if (tg?.HapticFeedback) {
      if (type === 'impact') tg.HapticFeedback.impactOccurred(style);
      if (type === 'notification') tg.HapticFeedback.notificationOccurred(style);
    }
  } catch (e) {}
}

/**
 * Universal Deep-Link Generator Helper
 * Builds official Telegram Mini App link without invalid duplicated segments
 */
function buildTelegramVisitorLink(shortCode) {
  const cleanCode = String(shortCode || '').replace(/^link_/, '').trim();
  if (APP_SHORT_NAME && APP_SHORT_NAME.toLowerCase() !== BOT_USERNAME.toLowerCase()) {
    return `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}?startapp=link_${cleanCode}`;
  }
  return `https://t.me/${BOT_USERNAME}?startapp=link_${cleanCode}`;
}

/**
 * Robust Telegram WebApp Start Parameter Extractor
 * Priority: initDataUnsafe.start_param -> tgWebAppStartParam -> startapp -> start -> link
 */
function getTelegramStartParam() {
  if (tg?.initDataUnsafe?.start_param) {
    return String(tg.initDataUnsafe.start_param).trim();
  }
  const urlParams = new URLSearchParams(window.location.search);
  const candidates = ['tgWebAppStartParam', 'startapp', 'start_param', 'start', 'link'];
  for (const param of candidates) {
    const val = urlParams.get(param);
    if (val && typeof val === 'string' && val.trim().length > 0) {
      return decodeURIComponent(val).trim();
    }
  }
  return null;
}

// =========================================================================
// 3. APP INITIALIZATION & ROUTING ENGINE
// =========================================================================
async function initApp() {
  const loadingEl = document.getElementById('ui-loading');
  const nonTgEl = document.getElementById('ui-non-telegram');
  const mainAppEl = document.getElementById('ui-main-app');

  // Check if opened inside Telegram
  if (!tg || !tg.initData) {
    if (loadingEl) loadingEl.classList.add('hidden');
    if (nonTgEl) nonTgEl.classList.remove('hidden');
    return;
  }

  // 1. Extract and validate routing start parameter
  const rawStartParam = getTelegramStartParam();
  let visitorShortCode = null;

  if (rawStartParam) {
    if (rawStartParam.startsWith('ref_')) {
      // Handled during Telegram authentication
    } else {
      const candidateCode = rawStartParam.replace(/^link_/, '').trim();
      // Security Validation: 3-32 alphanumeric/underscore chars
      if (candidateCode.match(/^[a-zA-Z0-9_-]{3,32}$/)) {
        visitorShortCode = candidateCode;
        window.visitorLinkCode = candidateCode;
        currentShortCode = candidateCode;
      }
    }
  }

  try {
    // 2. Authenticate with backend using cryptographically signed initData
    const authPayload = { initData: tg.initData };
    if (rawStartParam && rawStartParam.startsWith('ref_')) {
      authPayload.startParam = rawStartParam;
    }

    const authRes = await apiCall('/api/auth/telegram', 'POST', authPayload);
    if (!authRes.success || !authRes.user) {
      throw new Error(authRes.error || 'Authentication signature invalid');
    }

    authUser = authRes.user;
    updateUserUi(authUser);

    // 3. AUTOMATIC VISITOR ROUTING: If valid shortlink was provided, enter Visitor Flow immediately
    if (visitorShortCode) {
      await startVisitorFlow(visitorShortCode);
      return;
    }

    // 4. Standard Creator Dashboard Flow
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

// UI State Updater
function updateUserUi(user) {
  const greetingEl = document.getElementById('user-greeting');
  const profileNameEl = document.getElementById('profile-name');
  const profileAvatarEl = document.getElementById('profile-avatar');
  const profileIdEl = document.getElementById('profile-id');
  const referralLinkEl = document.getElementById('referral-link-display');

  const displayName = user.first_name || user.username || 'Creator';
  if (greetingEl) greetingEl.innerText = `Hello, ${displayName}!`;
  if (profileNameEl) profileNameEl.innerText = displayName;
  if (profileAvatarEl) profileAvatarEl.innerText = displayName.charAt(0).toUpperCase();
  if (profileIdEl) profileIdEl.innerText = `Telegram ID: ${user.id}`;
  if (referralLinkEl) referralLinkEl.innerText = `https://t.me/${BOT_USERNAME}?start=ref_${user.id}`;
}

// =========================================================================
// 4. NAVIGATION CONTROLLER
// =========================================================================
function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const target = this.getAttribute('data-target');
      switchPage(target);
    });
  });
}

function switchPage(pageId) {
  triggerHaptic('impact', 'light');
  document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'));
  const targetPage = document.getElementById(pageId);
  if (targetPage) targetPage.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const targetNav = document.querySelector(`.nav-btn[data-target="${pageId}"]`);
  if (targetNav) targetNav.classList.add('active');

  if (pageId === 'page-home') {
    loadDashboardData();
    loadDailyReport();
  }
  if (pageId === 'page-links') loadMyLinks();
  if (pageId === 'page-wallet') loadWalletData();
  if (pageId === 'page-refer') loadReferralData();
}

// =========================================================================
// 5. DASHBOARD & LINK CREATOR CONTROLLER
// =========================================================================
async function loadDashboardData() {
  const walletRes = await apiCall('/api/wallet', 'GET');
  if (walletRes.success) {
    const avail = parseFloat(walletRes.available_balance || 0);
    const earned = parseFloat(walletRes.total_earned || 0);

    const headerBal = document.getElementById('header-balance');
    const statAvail = document.getElementById('stat-avail-balance');
    const statEarned = document.getElementById('stat-total-earned');
    const statTodayEarn = document.getElementById('stat-today-earn');
    const statViews = document.getElementById('stat-views');
    const statCpm = document.getElementById('stat-cpm');

    if (headerBal) headerBal.innerText = `₹${avail.toFixed(2)}`;
    if (statAvail) statAvail.innerText = `₹${avail.toFixed(2)}`;
    if (statEarned) statEarned.innerText = `₹${earned.toFixed(2)}`;
    if (statTodayEarn) statTodayEarn.innerText = `₹${earned.toFixed(4)}`;
    if (statCpm) statCpm.innerText = `₹160.00`;
  }
}

function setupLinkShortener() {
  const btnShorten = document.getElementById('btn-shorten');
  const inputUrl = document.getElementById('long-url-input');
  const errorEl = document.getElementById('shorten-error');
  const resultBox = document.getElementById('shorten-result');
  const displayShortLink = document.getElementById('short-link-display');
  const btnCopy = document.getElementById('btn-copy-link');
  const btnShare = document.getElementById('btn-share-link');

  if (!btnShorten) return;

  btnShorten.addEventListener('click', async () => {
    const url = inputUrl.value.trim();
    if (!url || !url.match(/^https?:\/\//i)) {
      if (errorEl) {
        errorEl.innerText = 'Please enter a valid URL starting with http:// or https://';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    btnShorten.disabled = true;
    btnShorten.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Shortening...';

    try {
      const res = await apiCall('/api/links', 'POST', { url: url });
      if (!res.success || !res.link) {
        throw new Error(res.error || 'Failed to create short link');
      }

      triggerHaptic('notification', 'success');
      const shortUrl = res.link.short_url || buildTelegramVisitorLink(res.link.short_code);
      if (displayShortLink) displayShortLink.innerText = shortUrl;
      if (resultBox) resultBox.classList.remove('hidden');
      inputUrl.value = '';

      if (btnCopy) {
        btnCopy.onclick = () => {
          triggerHaptic('impact', 'medium');
          copyToClipboard(shortUrl, 'Short link copied!');
        };
      }

      if (btnShare) {
        btnShare.onclick = () => {
          const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(shortUrl)}&text=${encodeURIComponent('🔓 Open on TeleShort')}`;
          if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
          else window.open(shareUrl, '_blank');
        };
      }
    } catch (err) {
      if (errorEl) {
        errorEl.innerText = err.message || 'Error creating link';
        errorEl.classList.remove('hidden');
      }
    } finally {
      btnShorten.disabled = false;
      btnShorten.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles mr-2"></i><span>Shorten & Earn</span>';
    }
  });

  // Referral copy / share
  const btnCopyRef = document.getElementById('btn-copy-referral');
  const btnShareRef = document.getElementById('btn-share-referral');

  if (btnCopyRef) {
    btnCopyRef.addEventListener('click', () => {
      const refLink = document.getElementById('referral-link-display')?.innerText;
      if (refLink) copyToClipboard(refLink, 'Referral link copied!');
    });
  }

  if (btnShareRef) {
    btnShareRef.addEventListener('click', () => {
      const refLink = document.getElementById('referral-link-display')?.innerText;
      if (refLink) {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join TeleShort and monetize your Telegram links with instant daily payouts!')}`;
        if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
        else window.open(shareUrl, '_blank');
      }
    });
  }
}

// Daily Report Loader with Explicit State Handling
async function loadDailyReport() {
  const container = document.getElementById('earnings-list');
  if (!container) return;

  container.innerHTML = '<div class="text-center text-slate-500 py-6 text-xs"><i class="fa-solid fa-circle-notch fa-spin text-indigo-400 mr-2"></i> Loading daily activity...</div>';

  try {
    const txRes = await apiCall('/api/wallet/transactions', 'GET');
    if (!txRes.success) {
      container.innerHTML = `<div class="text-center text-slate-400 py-6 text-xs"><i class="fa-solid fa-triangle-exclamation text-amber-400 mb-1 block"></i> Unable to load report. <button onclick="loadDailyReport()" class="text-indigo-400 font-bold ml-1">Retry</button></div>`;
      return;
    }

    const txs = (txRes.transactions || []).filter(t => t.is_credit && t.reference_type === 'AD_REWARD');
    if (txs.length === 0) {
      container.innerHTML = '<div class="text-center text-slate-500 py-6 text-xs">No activity recorded for this period.</div>';
      return;
    }

    // Group by Date
    const dailyMap = {};
    txs.forEach(t => {
      const d = new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      if (!dailyMap[d]) dailyMap[d] = 0;
      dailyMap[d] += parseFloat(t.amount || 0);
    });

    container.innerHTML = '';
    for (const [dateStr, totalEarn] of Object.entries(dailyMap)) {
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center bg-slate-800/50 p-3 rounded-lg border border-slate-700/50';
      row.innerHTML = `
        <span class="text-xs text-slate-300"><i class="fa-regular fa-calendar text-indigo-400 mr-2"></i>${escapeHtml(dateStr)}</span>
        <span class="font-bold text-xs text-emerald-400">+₹${totalEarn.toFixed(4)}</span>
      `;
      container.appendChild(row);
    }
  } catch (e) {
    container.innerHTML = `<div class="text-center text-slate-400 py-6 text-xs"><i class="fa-solid fa-triangle-exclamation text-amber-400 mb-1 block"></i> Error loading report. <button onclick="loadDailyReport()" class="text-indigo-400 font-bold ml-1">Retry</button></div>`;
  }
}

// =========================================================================
// 6. MY LINKS CONTROLLER
// =========================================================================
async function loadMyLinks() {
  const container = document.getElementById('links-list');
  if (!container) return;

  container.innerHTML = '<div class="text-center text-slate-500 py-8 text-xs"><i class="fa-solid fa-circle-notch fa-spin text-xl mb-2 block text-indigo-400"></i> Loading your links...</div>';

  try {
    const res = await apiCall('/api/links', 'GET');
    if (!res.success) {
      container.innerHTML = `<div class="glass-panel p-6 text-center text-slate-400 text-xs"><i class="fa-solid fa-circle-exclamation text-amber-400 mb-2 text-xl block"></i> Unable to load links. Please check connection.<br><button onclick="loadMyLinks()" class="mt-3 px-4 py-1.5 bg-slate-800 text-indigo-400 rounded-lg text-xs font-bold border border-slate-700">Retry</button></div>`;
      return;
    }

    if (!res.links || res.links.length === 0) {
      container.innerHTML = '<div class="glass-panel p-6 text-center text-slate-400 text-xs">You have not created any short links yet.</div>';
      return;
    }

    container.innerHTML = '';
    res.links.forEach(link => {
      const card = document.createElement('div');
      card.className = 'glass-panel p-4 mb-3';
      const shortUrl = link.short_url || buildTelegramVisitorLink(link.short_code);
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <div class="truncate w-[75%]">
            <span class="text-indigo-400 font-mono text-xs block truncate font-semibold">${escapeHtml(shortUrl)}</span>
            <span class="text-[10px] text-slate-400 block truncate mt-0.5">${escapeHtml(link.original_url)}</span>
          </div>
          <button class="btn-copy-item bg-slate-800 p-2 rounded-lg text-emerald-400 hover:bg-slate-700 active:scale-95 transition-all">
            <i class="fa-solid fa-copy text-xs"></i>
          </button>
        </div>
        <div class="flex justify-between items-center pt-2 border-t border-slate-700/50 text-[11px]">
          <span class="text-slate-400"><i class="fa-solid fa-eye mr-1 text-slate-500"></i> <strong class="text-white">${link.clicks_count || link.click_count || 0}</strong> views</span>
          <span class="text-emerald-400 font-semibold"><i class="fa-solid fa-coins mr-1"></i> ₹${parseFloat(link.earnings || link.total_earnings || 0).toFixed(4)}</span>
        </div>
      `;

      card.querySelector('.btn-copy-item').onclick = () => {
        triggerHaptic('impact', 'light');
        copyToClipboard(shortUrl, 'Short link copied!');
      };

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="glass-panel p-6 text-center text-red-400 text-xs">Error loading links: ${escapeHtml(err.message)}</div>`;
  }
}

// =========================================================================
// 7. WALLET & WITHDRAWAL CONTROLLER (INR STANDARDIZED)
// =========================================================================
function setupWallet() {
  const btnSubmit = document.getElementById('btn-submit-withdraw');
  const errorEl = document.getElementById('withdraw-error');

  if (!btnSubmit) return;

  btnSubmit.addEventListener('click', async () => {
    const method = document.getElementById('withdraw-method')?.value || 'UPI';
    const address = document.getElementById('withdraw-details')?.value.trim();
    const amount = parseFloat(document.getElementById('withdraw-amount')?.value);

    if (!address) {
      if (errorEl) {
        errorEl.innerText = 'Please enter valid payment details (UPI ID / Address).';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (isNaN(amount) || amount < 100) {
      if (errorEl) {
        errorEl.innerText = 'Minimum withdrawal amount is ₹100.00.';
        errorEl.classList.remove('hidden');
      }
      return;
    }

    if (errorEl) errorEl.classList.add('hidden');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Submitting...';

    try {
      const res = await apiCall('/api/withdrawals', 'POST', {
        amount,
        payment_method: method,
        payout_address: address
      });

      if (!res.success) {
        throw new Error(res.error || 'Failed to submit withdrawal');
      }

      triggerHaptic('notification', 'success');
      safeAlert('Withdrawal request submitted successfully! ₹' + amount.toFixed(2) + ' reserved for review.');
      document.getElementById('withdraw-amount').value = '';
      document.getElementById('withdraw-details').value = '';
      loadWalletData();
    } catch (err) {
      if (errorEl) {
        errorEl.innerText = err.message || 'Withdrawal failed';
        errorEl.classList.remove('hidden');
      }
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-money-bill-transfer mr-2"></i><span>Submit Request</span>';
    }
  });
}

async function loadWalletData() {
  const availEl = document.getElementById('wallet-avail-balance');
  const availPageEl = document.getElementById('wallet-balance-page');
  const resrvEl = document.getElementById('wallet-reserved-balance');
  const totalEl = document.getElementById('wallet-total-balance');
  const minWithdrawEl = document.getElementById('min-withdraw-display');
  const historyList = document.getElementById('withdrawal-history-list');

  // 1. Fetch Authoritative Balances from Server
  const walletRes = await apiCall('/api/wallet', 'GET');
  if (walletRes.success) {
    const avail = parseFloat(walletRes.available_balance || 0);
    const resrv = parseFloat(walletRes.reserved_balance || 0);
    const total = parseFloat(walletRes.total_balance || 0);
    const minW = parseFloat(walletRes.min_withdrawal || 100.00);

    if (availEl) availEl.innerText = `₹${avail.toFixed(2)}`;
    if (availPageEl) availPageEl.innerText = `₹${avail.toFixed(2)}`;
    if (resrvEl) resrvEl.innerText = `₹${resrv.toFixed(2)}`;
    if (totalEl) totalEl.innerText = `₹${total.toFixed(2)}`;
    if (minWithdrawEl) minWithdrawEl.innerText = `₹${minW.toFixed(2)}`;
  }

  // 2. Fetch Authoritative Transaction Ledger History
  if (historyList) {
    historyList.innerHTML = '<div class="text-center text-slate-500 py-4 text-xs"><i class="fa-solid fa-circle-notch fa-spin text-indigo-400 mr-2"></i> Loading transactions...</div>';

    const txRes = await apiCall('/api/wallet/transactions', 'GET');
    if (txRes.success && txRes.transactions && txRes.transactions.length > 0) {
      historyList.innerHTML = '';
      txRes.transactions.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'glass-panel p-3.5 flex justify-between items-center mb-2.5';

        const isCredit = tx.is_credit;
        const color = isCredit ? 'text-emerald-400' : 'text-red-400';
        const sign = isCredit ? '+' : '';
        const dateStr = new Date(tx.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

        item.innerHTML = `
          <div>
            <div class="font-semibold text-white text-xs mb-0.5">${escapeHtml(tx.label)}</div>
            <div class="text-[10px] text-slate-400">${dateStr}</div>
          </div>
          <div class="text-right">
            <div class="font-bold text-xs ${color}">${sign}₹${parseFloat(tx.amount).toFixed(4)}</div>
            <div class="text-[9px] text-slate-400 uppercase font-mono">${escapeHtml(tx.status)}</div>
          </div>
        `;
        historyList.appendChild(item);
      });
    } else {
      historyList.innerHTML = '<div class="glass-panel p-5 text-center text-slate-500 text-xs">No transactions recorded yet.</div>';
    }
  }
}

async function loadReferralData() {
  const statRefEl = document.getElementById('stat-referrals');
  const refEarnEl = document.getElementById('ref-earnings');
  const listContainer = document.getElementById('referrals-list');

  if (listContainer) {
    listContainer.innerHTML = '<div class="text-center text-slate-500 py-6 text-sm glass-panel"><i class="fa-solid fa-circle-notch fa-spin text-indigo-400 mr-2"></i> Loading referrals...</div>';
  }

  try {
    const txRes = await apiCall('/api/wallet/transactions', 'GET');
    if (txRes.success && txRes.transactions) {
      const refTxs = txRes.transactions.filter(t => t.reference_type === 'REFERRAL_COMMISSION');
      let totalRefEarned = 0;
      refTxs.forEach(t => { totalRefEarned += parseFloat(t.amount || 0); });
      if (refEarnEl) refEarnEl.innerText = `₹${totalRefEarned.toFixed(4)}`;
      if (statRefEl) statRefEl.innerText = refTxs.length;

      if (listContainer) {
        if (refTxs.length === 0) {
          listContainer.innerHTML = '<div class="text-center text-slate-500 py-6 text-sm glass-panel">You have not referred anyone yet.</div>';
        } else {
          listContainer.innerHTML = '';
          refTxs.forEach(t => {
            listContainer.innerHTML += `
              <div class="glass-panel p-4 flex justify-between items-center mb-3">
                <span class="font-bold text-white text-sm"><i class="fa-solid fa-user text-slate-500 mr-2"></i>Referral Active</span>
                <span class="text-emerald-400 font-bold text-xs">+₹${parseFloat(t.amount).toFixed(4)}</span>
              </div>`;
          });
        }
      }
    }
  } catch (e) {
    if (listContainer) listContainer.innerHTML = '<div class="text-center text-slate-500 py-6 text-sm glass-panel">No referral data found.</div>';
  }
}

// =========================================================================
// 8. VISITOR SHORT-LINK & 2-STEP MONETAG INTERSTITIAL ENGINE (HARDENED)
// =========================================================================
async function startVisitorFlow(shortCode) {
  const loadingEl = document.getElementById('ui-loading');
  const mainAppEl = document.getElementById('ui-main-app');
  const adViewerEl = document.getElementById('ui-ad-viewer');

  // Hide Creator Dashboard immediately
  if (mainAppEl) mainAppEl.classList.add('hidden');
  if (loadingEl) loadingEl.classList.remove('hidden');

  try {
    // 1. Resolve Link & Check Force Join Gate
    const resolveRes = await apiCall('/api/visitor/resolve', 'POST', { short_code: shortCode });
    if (!resolveRes.success) {
      throw new Error(resolveRes.error || 'Link resolution failed');
    }

    if (loadingEl) loadingEl.classList.add('hidden');

    // 2. Force Join Check
    if (resolveRes.force_join_required && !resolveRes.force_join_passed) {
      showForceJoinScreen(resolveRes.channel?.channel_id || '@myfileshareskbot', shortCode);
      return;
    }

    // 3. Initiate Ad Session
    await initAdSession(shortCode);
  } catch (err) {
    if (loadingEl) loadingEl.classList.add('hidden');
    safeAlert('Link Error: ' + err.message);
  }
}

function showForceJoinScreen(channelId, shortCode) {
  const forceJoinEl = document.getElementById('ui-force-join');
  const btnJoin = document.getElementById('btn-force-join-channel');
  const btnVerify = document.getElementById('btn-force-join-verify');
  const errEl = document.getElementById('force-join-error');

  if (forceJoinEl) forceJoinEl.classList.remove('hidden');

  if (btnJoin && channelId) {
    const cleanChannel = channelId.replace('@', '');
    btnJoin.href = `https://t.me/${cleanChannel}`;
  }

  if (btnVerify) {
    btnVerify.onclick = async () => {
      btnVerify.disabled = true;
      btnVerify.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Checking...';
      if (errEl) errEl.classList.add('hidden');

      try {
        const verifyRes = await apiCall('/api/visitor/force-join', 'POST', {
          short_code: shortCode,
          force_refresh: true
        });

        if (verifyRes.success && verifyRes.joined) {
          triggerHaptic('notification', 'success');
          if (forceJoinEl) forceJoinEl.classList.add('hidden');
          await initAdSession(shortCode);
        } else {
          throw new Error('You have not joined the channel yet. Please join and tap again.');
        }
      } catch (e) {
        if (errEl) {
          errEl.innerText = e.message;
          errEl.classList.remove('hidden');
        }
      } finally {
        btnVerify.disabled = false;
        btnVerify.innerHTML = "<span>I've Joined</span>";
      }
    };
  }
}

async function initAdSession(shortCode) {
  const adViewerEl = document.getElementById('ui-ad-viewer');
  if (adViewerEl) adViewerEl.classList.remove('hidden');

  const startRes = await apiCall('/api/ad-session/start', 'POST', { short_code: shortCode });
  if (!startRes.success || !startRes.session_id) {
    throw new Error(startRes.error || 'Failed to start ad session');
  }

  currentSession = startRes;
  currentStep = startRes.step || 1;
  runAdStep(currentStep);
}

function runAdStep(step) {
  currentStep = step;
  const badgeEl = document.getElementById('ad-progress-badge');
  const timerTextEl = document.getElementById('ad-timer-text');
  const titleEl = document.getElementById('ad-step-title');
  const subtitleEl = document.getElementById('ad-step-subtitle');
  const btnWatch = document.getElementById('btn-watch-ad');
  const btnGetLink = document.getElementById('btn-get-link');
  const loaderRing = document.getElementById('ad-loader-ring');

  if (badgeEl) badgeEl.innerText = `Ad Step ${step} of 2`;
  if (titleEl) titleEl.innerText = `Ad Step ${step} of 2`;
  if (subtitleEl) subtitleEl.innerText = 'Please watch the ad to unlock destination.';
  if (btnGetLink) btnGetLink.classList.add('hidden');
  if (loaderRing) loaderRing.classList.add('hidden');
  if (timerTextEl) {
    timerTextEl.classList.remove('hidden');
    timerTextEl.innerText = '5';
  }

  let timeLeft = 5;
  if (btnWatch) {
    btnWatch.disabled = true;
    btnWatch.className = 'w-full bg-slate-800 text-slate-500 font-bold py-4 rounded-xl flex justify-center items-center shadow-inner';
    btnWatch.innerHTML = `<span>Please wait ${timeLeft}s...</span>`;
  }

  const countdown = setInterval(() => {
    timeLeft--;
    if (timerTextEl) timerTextEl.innerText = timeLeft;
    if (btnWatch) btnWatch.innerHTML = `<span>Please wait ${timeLeft}s...</span>`;

    if (timeLeft <= 0) {
      clearInterval(countdown);
      if (btnWatch) {
        btnWatch.disabled = false;
        btnWatch.className = 'w-full primary-gradient text-white font-bold py-4 rounded-xl flex justify-center items-center shadow-lg active:scale-95 transition-transform';
        btnWatch.innerHTML = `<span>Watch Ad ${step} & Continue</span>`;
        btnWatch.onclick = () => executeMonetagAd(step);
      }
    }
  }, 1000);
}

function executeMonetagAd(step) {
  const btnWatch = document.getElementById('btn-watch-ad');
  const loaderRing = document.getElementById('ad-loader-ring');
  const timerTextEl = document.getElementById('ad-timer-text');

  if (btnWatch) {
    btnWatch.disabled = true;
    btnWatch.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Loading Ad...';
  }
  if (loaderRing) loaderRing.classList.remove('hidden');
  if (timerTextEl) timerTextEl.classList.add('hidden');

  const startTime = Date.now();

  // Execute configured Monetag SDK Show Function with Fallback
  const monetagFn = window.show_11694314 || window.show_11515208 || (typeof show_11694314 === 'function' ? show_11694314 : null);

  if (typeof monetagFn === 'function') {
    monetagFn()
      .then(() => {
        handleAdStepCompletion(step, startTime);
      })
      .catch((err) => {
        handleAdFailure(step, startTime, err);
      });
  } else {
    // Graceful fallback for environments where ad blocker or local test is active
    setTimeout(() => handleAdStepCompletion(step, startTime), 1200);
  }
}

async function handleAdFailure(step, startTime, error) {
  const clientDuration = Date.now() - startTime;
  const btnWatch = document.getElementById('btn-watch-ad');
  const loaderRing = document.getElementById('ad-loader-ring');
  const timerTextEl = document.getElementById('ad-timer-text');

  if (loaderRing) loaderRing.classList.add('hidden');
  if (timerTextEl) timerTextEl.classList.remove('hidden');

  await apiCall('/api/ad-session/event', 'POST', {
    session_id: currentSession.session_id,
    step: step,
    event_type: 'AD_FAILED',
    challenge_token: currentSession.challenge_token,
    client_duration_ms: clientDuration
  });

  safeAlert('Ad was not completed or was blocked. Please watch the ad to unlock.');

  if (btnWatch) {
    btnWatch.disabled = false;
    btnWatch.className = 'w-full warning-gradient text-white font-bold py-4 rounded-xl flex justify-center items-center shadow-lg active:scale-95 transition-transform';
    btnWatch.innerHTML = `<span>Try Watching Ad ${step} Again</span>`;
    btnWatch.onclick = () => executeMonetagAd(step);
  }
}

async function handleAdStepCompletion(step, startTime) {
  const clientDuration = Date.now() - startTime;

  try {
    const eventRes = await apiCall('/api/ad-session/event', 'POST', {
      session_id: currentSession.session_id,
      step: step,
      event_type: 'AD_COMPLETED',
      challenge_token: currentSession.challenge_token,
      client_duration_ms: clientDuration
    });

    if (!eventRes.success) {
      throw new Error(eventRes.error || 'Ad verification failed. Please try again.');
    }

    if (step === 1) {
      currentSession.challenge_token = eventRes.challenge_token;
      triggerHaptic('impact', 'medium');
      runAdStep(2);
    } else if (step === 2) {
      await claimRewardAndUnlock();
    }
  } catch (err) {
    safeAlert(err.message || 'Ad event processing error');
    runAdStep(step);
  }
}

async function claimRewardAndUnlock() {
  const titleEl = document.getElementById('ad-step-title');
  const subtitleEl = document.getElementById('ad-step-subtitle');
  const btnWatch = document.getElementById('btn-watch-ad');
  const btnGetLink = document.getElementById('btn-get-link');
  const badgeEl = document.getElementById('ad-progress-badge');
  const timerContainer = document.getElementById('ad-timer-container');

  if (titleEl) titleEl.innerText = 'Unlocking Destination...';
  if (subtitleEl) subtitleEl.innerText = 'Processing your reward...';

  try {
    const claimRes = await apiCall('/api/reward/claim', 'POST', {
      session_id: currentSession.session_id
    });

    if (!claimRes.success || !claimRes.destination_url) {
      throw new Error(claimRes.error || 'Failed to claim reward and unlock destination');
    }

    triggerHaptic('notification', 'success');

    if (badgeEl) badgeEl.classList.add('hidden');
    if (timerContainer) timerContainer.classList.add('hidden');
    if (btnWatch) btnWatch.classList.add('hidden');

    if (titleEl) titleEl.innerText = 'Destination Unlocked! 🎉';
    if (subtitleEl) subtitleEl.innerText = 'Tap below to visit your link.';

    if (btnGetLink) {
      btnGetLink.classList.remove('hidden');
      btnGetLink.onclick = () => {
        triggerHaptic('impact', 'heavy');
        if (tg?.openLink) {
          tg.openLink(claimRes.destination_url);
        } else {
          window.location.href = claimRes.destination_url;
        }
      };
    }
  } catch (err) {
    safeAlert('Reward Claim Error: ' + err.message);
  }
}

// =========================================================================
// 9. WINDOW LOAD TRIGGER
// =========================================================================
window.addEventListener('DOMContentLoaded', initApp);
