/**
 * TeleShort v2.1 — Production Telegram Mini App Frontend Engine (Phase 10 Hardened)
 * Connects Telegram WebApp SDK to secured backend APIs for authentication, link creation,
 * Force Join gate, 2-Step Monetag interstitial ads, atomic reward claiming, and wallet management.
 */

// =========================================================================
// 1. STATE & TELEGRAM INITIALIZATION
// =========================================================================
const tg = window.Telegram?.WebApp;
let authUser = null;
let currentShortCode = null;
let currentSession = null;
let currentStep = 1;
const BOT_USERNAME = 'myfileshareskbot';

// Telegram WebApp Setup
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#0f172a');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0f172a');
  } catch (e) {
    console.warn('[Telegram SDK Error]:', e);
  }
}

// =========================================================================
// 2. CENTRALIZED API CLIENT
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
    // Automatically attach initData in POST body if available
    const payload = typeof body === 'object' ? { ...body } : {};
    if (tg?.initData && !payload.initData) {
      payload.initData = tg.initData;
    }
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(endpoint, options);
  const data = await response.json().catch(() => ({ success: false, error: 'Invalid JSON response' }));

  if (!response.ok && !data.error) {
    data.error = `HTTP ${response.status}: ${response.statusText}`;
  }

  return data;
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

// =========================================================================
// 3. APP INITIALIZATION & AUTHENTICATION
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

  try {
    // 1. Authenticate with backend using verified initData
    const authRes = await apiCall('/api/auth/telegram', 'POST', { initData: tg.initData });
    if (!authRes.success || !authRes.user) {
      throw new Error(authRes.error || 'Authentication signature invalid');
    }

    authUser = authRes.user;
    updateUserUi(authUser);

    // 2. Check for Visitor Short Link (startparam)
    let startParam = tg.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get('start');
    if (startParam) {
      // Clean start param prefix
      startParam = startParam.replace(/^link_/, '').trim();
      currentShortCode = startParam;
      await startVisitorFlow(startParam);
      return;
    }

    // 3. Render Standard Creator Dashboard
    if (loadingEl) loadingEl.classList.add('hidden');
    if (mainAppEl) mainAppEl.classList.remove('hidden');

    setupNavigation();
    setupLinkShortener();
    setupWallet();
    loadDashboardData();
  } catch (err) {
    console.error('[Init Error]:', err);
    const loadingText = document.getElementById('loading-text');
    if (loadingText) {
      loadingText.innerHTML = `<span class="text-red-400">Error: ${escapeHtml(err.message)}</span>`;
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

  if (pageId === 'page-home') loadDashboardData();
  if (pageId === 'page-links') loadMyLinks();
  if (pageId === 'page-wallet') loadWalletData();
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

    if (headerBal) headerBal.innerText = `₹${avail.toFixed(2)}`;
    if (statAvail) statAvail.innerText = `₹${avail.toFixed(2)}`;
    if (statEarned) statEarned.innerText = `₹${earned.toFixed(2)}`;
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
      const res = await apiCall('/api/links', 'POST', { original_url: url });
      if (!res.success || !res.link) {
        throw new Error(res.error || 'Failed to create short link');
      }

      triggerHaptic('notification', 'success');
      const shortUrl = res.link.short_url;
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
          const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(shortUrl)}&text=${encodeURIComponent('🔓 Open Link on TeleShort')}`;
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

// =========================================================================
// 6. MY LINKS CONTROLLER
// =========================================================================
async function loadMyLinks() {
  const container = document.getElementById('links-list');
  if (!container) return;

  container.innerHTML = '<div class="text-center text-slate-500 py-8 text-xs"><i class="fa-solid fa-circle-notch fa-spin text-xl mb-2 block text-indigo-400"></i> Loading your links...</div>';

  try {
    const res = await apiCall('/api/links', 'GET');
    if (!res.success || !res.links || res.links.length === 0) {
      container.innerHTML = '<div class="glass-panel p-6 text-center text-slate-400 text-xs">You have not created any short links yet.</div>';
      return;
    }

    container.innerHTML = '';
    res.links.forEach(link => {
      const card = document.createElement('div');
      card.className = 'glass-panel p-4 mb-2.5';
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <div class="truncate w-[75%]">
            <span class="text-indigo-400 font-mono text-xs block truncate font-semibold">${escapeHtml(link.short_url)}</span>
            <span class="text-[10px] text-slate-400 block truncate mt-0.5">${escapeHtml(link.original_url)}</span>
          </div>
          <button class="btn-copy-item bg-slate-800 p-2 rounded-lg text-emerald-400 hover:bg-slate-700 active:scale-95 transition-all">
            <i class="fa-solid fa-copy text-xs"></i>
          </button>
        </div>
        <div class="flex justify-between items-center pt-2 border-t border-slate-700/50 text-[11px]">
          <span class="text-slate-400"><i class="fa-solid fa-eye mr-1 text-slate-500"></i> <strong class="text-white">${link.clicks_count || 0}</strong> clicks</span>
          <span class="text-emerald-400 font-semibold"><i class="fa-solid fa-coins mr-1"></i> ₹${parseFloat(link.earnings || 0).toFixed(4)}</span>
        </div>
      `;

      card.querySelector('.btn-copy-item').onclick = () => {
        triggerHaptic('impact', 'light');
        copyToClipboard(link.short_url, 'Short link copied!');
      };

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<div class="text-center text-red-400 py-4 text-xs">Error loading links: ${escapeHtml(err.message)}</div>`;
  }
}

// =========================================================================
// 7. WALLET & WITHDRAWAL CONTROLLER
// =========================================================================
function setupWallet() {
  const btnSubmit = document.getElementById('btn-submit-withdraw');
  const errorEl = document.getElementById('withdraw-error');

  if (!btnSubmit) return;

  btnSubmit.addEventListener('click', async () => {
    const method = document.getElementById('withdraw-method')?.value || 'UPI';
    const address = document.getElementById('withdraw-address')?.value.trim();
    const amount = parseFloat(document.getElementById('withdraw-amount')?.value);

    if (!address) {
      if (errorEl) {
        errorEl.innerText = 'Please enter your UPI ID or payout address.';
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
      safeAlert('Withdrawal request submitted successfully! Funds reserved for review.');
      document.getElementById('withdraw-amount').value = '';
      document.getElementById('withdraw-address').value = '';
      loadWalletData();
    } catch (err) {
      if (errorEl) {
        errorEl.innerText = err.message || 'Withdrawal failed';
        errorEl.classList.remove('hidden');
      }
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = '<i class="fa-solid fa-money-bill-transfer mr-2"></i><span>Submit Withdrawal</span>';
    }
  });
}

async function loadWalletData() {
  const availEl = document.getElementById('wallet-avail-balance');
  const resrvEl = document.getElementById('wallet-reserved-balance');
  const totalEl = document.getElementById('wallet-total-balance');
  const historyList = document.getElementById('wallet-history-list');

  // 1. Fetch Balances
  const walletRes = await apiCall('/api/wallet', 'GET');
  if (walletRes.success) {
    if (availEl) availEl.innerText = `₹${parseFloat(walletRes.available_balance || 0).toFixed(2)}`;
    if (resrvEl) resrvEl.innerText = `₹${parseFloat(walletRes.reserved_balance || 0).toFixed(2)}`;
    if (totalEl) totalEl.innerText = `₹${parseFloat(walletRes.total_balance || 0).toFixed(2)}`;
  }

  // 2. Fetch Transaction Ledger History
  if (historyList) {
    const txRes = await apiCall('/api/wallet/transactions', 'GET');
    if (txRes.success && txRes.transactions && txRes.transactions.length > 0) {
      historyList.innerHTML = '';
      txRes.transactions.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'glass-panel p-3.5 flex justify-between items-center';

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

// =========================================================================
// 8. VISITOR SHORT-LINK & 2-STEP MONETAG INTERSTITIAL ENGINE (HARDENED)
// =========================================================================
async function startVisitorFlow(shortCode) {
  const loadingEl = document.getElementById('ui-loading');
  const forceJoinEl = document.getElementById('ui-force-join');

  try {
    // 1. Resolve Link & Check Force Join Gate
    const resolveRes = await apiCall('/api/visitor/resolve', 'POST', { short_code: shortCode });
    if (!resolveRes.success) {
      throw new Error(resolveRes.error || 'Link resolution failed');
    }

    if (loadingEl) loadingEl.classList.add('hidden');

    // 2. Force Join Check
    if (resolveRes.force_join_required && !resolveRes.force_join_passed) {
      showForceJoinScreen(resolveRes.force_join_channel, shortCode);
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

  // Trigger Monetag Web Interstitial SDK with Hardened Error Handlers
  if (typeof show_11515208 === 'function') {
    show_11515208()
      .then(() => {
        // Monetag Ad Completed
        handleAdStepCompletion(step, startTime);
      })
      .catch((err) => {
        // Monetag Ad Blocked or Failed: Do NOT award completion
        handleAdFailure(step, startTime, err);
      });
  } else {
    // Sandbox fallback for local development tests
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

  // Submit Failure Event to Server Telemetry
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
      // Advance to Step 2
      currentSession.challenge_token = eventRes.challenge_token;
      triggerHaptic('impact', 'medium');
      runAdStep(2);
    } else if (step === 2) {
      // Step 2 Completed -> REWARD_ELIGIBLE -> Claim Reward
      await claimRewardAndUnlock();
    }
  } catch (err) {
    safeAlert(err.message || 'Ad event processing error');
    runAdStep(step); // Allow retry
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
