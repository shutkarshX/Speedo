/**
 * Automator Core
 * Shared runtime engine providing HUD, notifications, CSP-safe execution,
 * and AI debug bridge communication across all platforms.
 */
window.AutomatorCore = (function () {
  let isRunning = false;
  let hudElement = document.getElementById('ca-floating-hud');
  let activePlatformInstance = null;

  if (hudElement) {
    hudElement.remove();
    hudElement = null;
  }

  function getIsRunning() {
    return isRunning;
  }

  function setIsRunning(val) {
    isRunning = val;
  }

  function setActivePlatform(platform) {
    activePlatformInstance = platform;
  }

  function getActivePlatform() {
    return activePlatformInstance;
  }

  /**
   * Universal logging to console, extension popup, and live AI debug server
   */
  function notify(text, type = 'info') {
    const platformTag = activePlatformInstance ? `[${activePlatformInstance.name}]` : '[Core]';
    console.log(`[Course Automator] ${platformTag} [${type.toUpperCase()}] ${text}`);

    try {
      chrome.runtime.sendMessage({
        action: 'POPUP_LOG',
        payload: { text: `${platformTag} ${text}`, type }
      }).catch(() => {});
    } catch (e) {}
  }

  /**
   * Floating HUD controls
   */
  function showHUD(initialText, onStop) {
    // Render in top window OR inside fullscreen contest assessment frames
    const isContestFrame = window.location.hostname.includes('infosysapps.com') || window.location.pathname.includes('/contest/');
    if (window !== window.top && !isContestFrame) return;
    if (hudElement) hudElement.remove();

    hudElement = document.createElement('div');
    hudElement.id = 'ca-floating-hud';
    hudElement.setAttribute('data-ui', '');
    hudElement.innerHTML = `
      <div class="ca-hud-top">
        <div class="ca-hud-badge">
          <span class="ca-hud-pulse"></span>
          <span class="ca-hud-platform">${activePlatformInstance ? activePlatformInstance.name : 'SPEEDO'}</span>
        </div>
        <div class="ca-hud-right">
          <span id="ca-hud-percent" class="ca-hud-percent">0%</span>
          <button id="ca-hud-stop-btn" class="ca-hud-stop-btn" title="Stop Automation">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"></rect>
            </svg>
            <span>Stop</span>
          </button>
        </div>
      </div>
      <div class="ca-hud-track">
        <div id="ca-hud-fill" class="ca-hud-fill"></div>
      </div>
      <div id="ca-hud-status" class="ca-hud-status">${initialText}</div>
    `;
    document.body.appendChild(hudElement);

    const stopBtn = document.getElementById('ca-hud-stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        stop('Automation stopped by user via HUD.');
        if (typeof onStop === 'function') {
          try { onStop(); } catch (e) {}
        }
      });
    }
  }

  function updateHUD(text, percent) {
    if (!hudElement) return;
    const statusEl = document.getElementById('ca-hud-status');
    const fillEl = document.getElementById('ca-hud-fill');
    const percentEl = document.getElementById('ca-hud-percent');

    if (statusEl) statusEl.textContent = text;
    if (fillEl && percent !== undefined && percent !== null) fillEl.style.width = `${percent}%`;
    if (percentEl && percent !== undefined && percent !== null) percentEl.textContent = `${percent}%`;
  }

  function removeHUD() {
    if (hudElement) {
      hudElement.remove();
      hudElement = null;
    }
  }

  /**
   * Execute command in page's MAIN world via background service worker
   */
  function runInMainWorld(command) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ timeout: true });
      }, 2000);

      try {
        chrome.runtime.sendMessage({
          action: 'EXEC_IN_MAIN_WORLD',
          command: command
        }, (res) => {
          clearTimeout(timer);
          resolve(res || { success: true });
        });
      } catch (e) {
        clearTimeout(timer);
        resolve({ error: e.message });
      }
    });
  }

  /**
   * Stop automation and clean up state
   */
  function stop(reason = 'Automation stopped.') {
    if (!isRunning) return; // Prevent recursive trigger loop
    isRunning = false;
    try {
      chrome.storage.local.remove([
        'pathwayRunner',
        'autoResumeCourse',
        'springboardRunning',
        'speedoRunning',
        'speedoEnabled',
        'speedo_quiz_running',
        'speedo_last_quiz_completed'
      ]);
      chrome.runtime.sendMessage({ action: 'STOP_PATHWAY' }).catch(() => {});
    } catch (e) {}
    notify(reason, reason.includes('100%') ? 'info' : 'warn');
    updateHUD(reason, 0);

    if (activePlatformInstance && typeof activePlatformInstance.onStop === 'function') {
      try { activePlatformInstance.onStop(reason); } catch (e) {}
    }
  }

  /**
   * Live DOM capture for AI inspection
   */
  async function captureAndSendPage() {
    const payload = {
      url: window.location.href,
      title: document.title,
      html: document.documentElement.outerHTML
    };

    try {
      chrome.runtime.sendMessage({
        action: 'SEND_DEBUG_DUMP',
        payload
      }).catch(() => {});
    } catch (e) {}
    return { success: true };
  }

  /**
   * Assessment QA Cache & Persistence Engine
   */
  async function getCachedAnswer(questionText) {
    if (!questionText) return null;
    try {
      const stored = await chrome.storage.local.get(['speedo_qa_cache']);
      const cache = stored.speedo_qa_cache || {};
      const normKey = questionText.trim().toLowerCase().replace(/\s+/g, ' ');
      if (cache[normKey]) return cache[normKey];
      for (const [k, v] of Object.entries(cache)) {
        if (normKey.includes(k) || k.includes(normKey)) {
          return v;
        }
      }
    } catch (e) {}
    return null;
  }

  async function saveAnswerToCache(questionText, correctTexts = [], correctIndices = []) {
    if (!questionText) return;
    try {
      const stored = await chrome.storage.local.get(['speedo_qa_cache']);
      const cache = stored.speedo_qa_cache || {};
      const normKey = questionText.trim().toLowerCase().replace(/\s+/g, ' ');
      cache[normKey] = {
        correctTexts: Array.isArray(correctTexts) ? correctTexts : [correctTexts],
        correctIndices: Array.isArray(correctIndices) ? correctIndices : [correctIndices],
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ speedo_qa_cache: cache });
      console.log(`[SPEEDO Core] Cached answer for question: "${normKey.slice(0, 50)}..."`);
    } catch (e) {}
  }

  // Cross-world / frame message listener for intercepted answers and IAP lifecycle
  window.addEventListener('message', async (event) => {
    if (event.data?.type === 'SPEEDO_ASSESSMENT_ANSWERS_FOUND' && Array.isArray(event.data.questions)) {
      const { questions } = event.data;
      try {
        const stored = await chrome.storage.local.get(['speedo_qa_cache']);
        const cache = stored.speedo_qa_cache || {};
        for (const q of questions) {
          if (!q.question) continue;
          const normKey = q.question.trim().toLowerCase().replace(/\s+/g, ' ');
          cache[normKey] = {
            options: q.options || [],
            correctIndices: q.correctIndices || [],
            correctTexts: q.correctTexts || [],
            updatedAt: Date.now()
          };
        }
        await chrome.storage.local.set({ speedo_qa_cache: cache });
        console.log(`[SPEEDO Core] Persisted ${questions.length} intercepted answers into speedo_qa_cache.`);
      } catch (e) {}
    } else if (event.data?.type === 'SPEEDO_IAP_COMPLETED') {
      window.__SPEEDO_IAP_FINISHED__ = true;
      console.log('[SPEEDO Core] Received SPEEDO_IAP_COMPLETED signal.');
    }
  });

  return {
    get isRunning() { return getIsRunning(); },
    setIsRunning,
    setActivePlatform,
    getActivePlatform,
    notify,
    showHUD,
    updateHUD,
    removeHUD,
    runInMainWorld,
    stop,
    captureAndSendPage,
    getCachedAnswer,
    saveAnswerToCache
  };
})();
