/**
 * Course & Pathway Automator - Core Content Script & Platform Dispatcher
 * Automatically detects the current learning platform (e.g., FutureSkills Prime, Generic, etc.)
 * and delegates execution to the matched platform adapter.
 */

(async function initAutomatorDispatcher() {
  console.log('[Course Automator] Initializing multi-platform orchestrator on:', window.location.hostname);

  // 1. Resolve matching platform adapter
  const platform = window.PlatformRegistry ? window.PlatformRegistry.detectPlatform() : null;
  if (!platform) {
    console.warn('[Course Automator] No matching platform adapter found.');
    return;
  }

  AutomatorCore.setActivePlatform(platform);
  console.log(`[Course Automator] Platform detected & activated: "${platform.name}" (${platform.id})`);

  // 2. Initialize platform adapter (lifecycle checks, banner injection, auto-resume)
  if (typeof platform.init === 'function') {
    try {
      await platform.init();
    } catch (err) {
      console.error(`[Course Automator] Platform "${platform.name}" init failed:`, err);
    }
  }

  // 3. Message broker for extension popup and background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'START_AUTOMATION':
        if (platform && typeof platform.start === 'function') {
          platform.start();
          sendResponse({ status: 'started', platform: platform.name });
        } else {
          sendResponse({ status: 'error', message: 'No active platform runner available.' });
        }
        break;

      case 'STOP_AUTOMATION':
        AutomatorCore.stop('Automation stopped by user.');
        sendResponse({ status: 'stopped' });
        break;

      case 'GET_STATUS':
        sendResponse({
          isRunning: AutomatorCore.isRunning,
          platformId: platform ? platform.id : 'unknown',
          platformName: platform ? platform.name : 'Unknown Platform',
          isPathway: platform && typeof platform.isPathwayPage === 'function' ? platform.isPathwayPage() : false,
          isPlayer: platform && typeof platform.isCoursePlayerPage === 'function' ? platform.isCoursePlayerPage() : false
        });
        break;

      default:
        sendResponse({ status: 'unknown_action' });
    }
    return true;
  });

  // 4. Intercept player URL messages from MAIN world to bypass popup blockers
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CA_OPEN_PLAYER_TAB') {
      const targetUrl = event.data.url;
      console.log('[Course Automator] Intercepted CA_OPEN_PLAYER_TAB:', targetUrl);
      chrome.runtime.sendMessage({
        action: 'OPEN_PLAYER_TAB',
        url: targetUrl
      }).catch(() => {});
    }
  });

  // 5. Universal cross-frame runner synchronization via storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.speedoRunning) {
      if (changes.speedoRunning.newValue === true) {
        if (platform && typeof platform.start === 'function') {
          platform.start();
        }
      } else if (changes.speedoRunning.newValue === false) {
        AutomatorCore.stop('Automation stopped.');
      }
    }
  });
})();
