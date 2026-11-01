/**
 * Page Guard - Runs in page's MAIN world at document_start
 * Permanently neutralizes thread-blocking native alerts/confirms to eliminate "Page Unresponsive" hangs.
 * Intercepts window.open to bypass Chrome popup blockers.
 */
(function installPageGuard() {
  if (window._caPageGuardInstalled) return;
  window._caPageGuardInstalled = true;

  // 1. Neutralize blocking modal dialogs
  window.alert = function(msg) {
    console.log('[Page Guard - Suppressed alert]:', msg);
    return true;
  };
  window.confirm = function(msg) {
    console.log('[Page Guard - Auto-approved confirm]:', msg);
    return true;
  };
  window.prompt = function(msg, def) {
    console.log('[Page Guard - Auto-filled prompt]:', msg);
    return def || '';
  };

  // 2. Suppress blocking beforeunload dialogs
  window.onbeforeunload = null;
  const originalAddEventListener = window.addEventListener;
  window.addEventListener = function(type, listener, options) {
    if (type === 'beforeunload') {
      return; // Drop beforeunload listeners to prevent page reload freeze
    }
    return originalAddEventListener.call(window, type, listener, options);
  };

  // 3. Intercept window.open for popup blocker bypass
  const nativeOpen = window.open;
  window.open = function(url, target, features) {
    console.log('[Page Guard] Captured window.open:', url);
    if (url && (url.includes('content_players') || url.includes('futureskillsprime.in') || url.includes('iHUB'))) {
      window.postMessage({ type: 'CA_OPEN_PLAYER_TAB', url: url }, '*');
      return null;
    }
    return nativeOpen ? nativeOpen.call(window, url, target, features) : null;
  };

  console.log('[Course Automator] ✅ Page Guard active in MAIN world.');
})();
