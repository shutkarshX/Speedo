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

    fetch('http://127.0.0.1:8765/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `${platformTag} ${text}`, level: type })
    }).catch(() => {});
  }

  /**
   * Floating HUD controls
   */
  function showHUD(initialText, onStop) {
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
    isRunning = false;
    chrome.storage.local.remove(['pathwayRunner', 'autoResumeCourse', 'springboardRunning']);
    chrome.runtime.sendMessage({ action: 'STOP_PATHWAY' }).catch(() => {});
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
      const res = await fetch('http://127.0.0.1:8765/dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return await res.json();
    } catch (err) {
      console.error('[Course Automator] Failed to send page dump:', err);
      throw err;
    }
  }

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
    captureAndSendPage
  };
})();
