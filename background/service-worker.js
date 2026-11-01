/**
 * Background Service Worker (Manifest V3)
 * - Automatically re-injects scripts into open course tabs on reload.
 * - Safely executes actions in the page's MAIN world via chrome.scripting.executeScript
 *   completely bypassing website CSP (eliminates inline script CSP violations).
 * - Intercepts window.open calls and uses chrome.tabs.create to 100% bypass Chrome popup blockers.
 * - Suppresses thread-blocking native alerts/confirms to prevent "Page Unresponsive" hangs.
 * - Orchestrates Multi-Module Pathway progression cleanly.
 */

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Course Automator] Extension reloaded. Auto-injecting into active tabs...');

  try {
    const tabs = await chrome.tabs.query({
      url: [
        '*://*.futureskillsprime.in/*',
        '*://futureskillsprime.in/*',
        '*://*.onwingspan.com/*',
        '*://*.infyspringboard.onwingspan.com/*'
      ]
    });

    for (const tab of tabs) {
      if (!tab.id) continue;

      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          files: ['content/page-guard.js']
        }).catch(() => {});

        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content.css']
        });

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [
            'utils/dom-helpers.js',
            'content/core/automator-core.js',
            'content/core/platform-registry.js',
            'content/platforms/generic/generic.adapter.js',
            'content/platforms/futureskills/futureskills.adapter.js',
            'content/platforms/springboard/springboard.adapter.js',
            'content/content.js'
          ]
        });

        console.log(`[Course Automator] ✅ Auto-injected into Tab ${tab.id}`);
      } catch (err) {
        console.warn(`[Course Automator] Could not auto-inject tab ${tab.id}:`, err);
      }
    }
  } catch (error) {
    console.error('[Course Automator] onInstalled injection failed:', error);
  }
});

// Central Message Broker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. Open Player Tab via Native Extension API (Bypasses 100% of Chrome Popup Blockers)
  if (message.action === 'OPEN_PLAYER_TAB') {
    const targetUrl = message.url;
    console.log('[Course Automator] Native tab creation requested for:', targetUrl);

    if (targetUrl) {
      chrome.tabs.create({ url: targetUrl, active: true }).then((newTab) => {
        console.log('[Course Automator] Successfully created player tab ID:', newTab.id);
        sendResponse({ success: true, tabId: newTab.id });
      }).catch((err) => {
        console.error('[Course Automator] Failed to create player tab:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  }

  // 2. Execute functions directly inside page's MAIN world (CSP-safe)
  if (message.action === 'EXEC_IN_MAIN_WORLD') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID found' });
      return false;
    }

    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: (command) => {
        try {
          // Neutralize blocking modal dialogs that cause "Page Unresponsive"
          window.alert = function(msg) { console.log('[Suppressed alert]:', msg); return true; };
          window.confirm = function(msg) { console.log('[Auto-confirmed confirm]:', msg); return true; };
          window.prompt = function(msg, def) { return def || ''; };
          window.onbeforeunload = null;

          // Intercept window.open to bypass Chrome's automated popup blocker
          if (!window._openInterceptorInstalled) {
            window._openInterceptorInstalled = true;
            const nativeOpen = window.open;
            window.open = function(url, target, features) {
              console.log('[Course Automator Interceptor] Captured window.open:', url);
              if (url && (url.includes('content_players') || url.includes('futureskillsprime.in'))) {
                window.postMessage({ type: 'CA_OPEN_PLAYER_TAB', url: url }, '*');
                return null;
              }
              return nativeOpen ? nativeOpen.call(window, url, target, features) : null;
            };
          }

          if (command === 'VIDEO_ENDED') {
            if (window.videojs && typeof window.videojs.getPlayers === 'function') {
              try {
                Object.values(window.videojs.getPlayers()).forEach(p => {
                  if (p && !p.isDisposed()) {
                    p.muted(true);
                    if (p.duration && p.duration()) {
                      p.currentTime(p.duration() - 0.1);
                    }
                    p.trigger('timeupdate');
                    p.trigger('ended');
                  }
                });
              } catch (e) {}
            }
            if (typeof window.on_video_ended === 'function') {
              window.on_video_ended();
            } else if (typeof window.markings === 'function') {
              window.markings();
            }
          } else if (command === 'MARK_READ') {
            if (typeof window.mark_unmark_content === 'function') {
              window.mark_unmark_content('No');
            }
          } else if (command === 'BACK_BUTTON') {
            if (typeof window.back_button === 'function') {
              window.back_button();
            }
          } else if (command === 'NEXT_BUTTON') {
            if (typeof window.check_popup === 'function') {
              window.check_popup();
            } else if (typeof window.next_button === 'function') {
              window.next_button();
            }
          } else if (command === 'SUBMIT_HANDSON') {
            const btn = document.getElementById('focus_submit_handson') || 
                        document.querySelector('button[aria-label="submit code pane text"]');
            if (btn) {
              console.log('[MAIN World] Clicking Submit on Hands-on exercise');
              btn.click();
            }
          } else if (command === 'VERIFY_HANDSON') {
            const btn = document.getElementById('focus_verify_handson') || 
                        document.querySelector('button[aria-label="verify code pane text"]');
            if (btn) {
              console.log('[MAIN World] Clicking Verify on Hands-on exercise');
              btn.click();
            }
          } else if (command === 'TRIGGER_MARK_COMPLETE') {
            const btn = document.querySelector('button[aria-label="mark as complete"], button.mark-as-complete-mini');
            if (btn) {
              console.log('[MAIN World] Triggering Mark as Complete icon');
              btn.click();
            }
          } else if (command === 'CONFIRM_MARK_COMPLETE') {
            const dialog = document.querySelector('ws-widget-mark-as-complete-dialog, mat-dialog-container');
            if (dialog) {
              const btns = Array.from(dialog.querySelectorAll('button'));
              const confirm = btns.find(b => {
                const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
                return (txt.includes('mark as complete') || txt.includes('yes') || txt.includes('confirm') || txt.includes('ok')) && 
                       !txt.includes('cancel');
              });
              if (confirm) {
                console.log('[MAIN World] Confirming Mark as Complete dialog');
                confirm.click();
              }
            }
          } else if (command === 'NEXT_CONTENT') {
            const btn = document.querySelector('button[aria-label="next content"], button.navigation-btn-frwd, .navigation-btn-frwd');
            if (btn) {
              console.log('[MAIN World] Clicking Next Content button');
              btn.click();
            }
          } else if (typeof command === 'string' && command.startsWith('GET_SUB_DATA:')) {
            const prodId = command.split(':')[1];
            if (typeof window.getsubdata === 'function') {
              console.log('[Course Automator] Invoking window.getsubdata(' + prodId + ')');
              window.getsubdata(prodId);
            }
          }
        } catch (e) {
          console.warn('[Course Automator Main World Error]', e);
        }
      },
      args: [message.command]
    })
    .then(() => sendResponse({ success: true }))
    .catch((err) => sendResponse({ success: false, error: err.message }));

    return true; // Keep channel open for async response
  }

  // 3. Handle Module Completion from Course Player Tab
  if (message.action === 'MODULE_COMPLETED') {
    const playerTabId = sender.tab ? sender.tab.id : null;
    console.log('[Course Automator] Received MODULE_COMPLETED for player tab', playerTabId);

    chrome.storage.local.get(['pathwayRunner'], async (data) => {
      const runner = data?.pathwayRunner;
      if (runner && runner.active) {
        // Record completed module in persistent memory
        const completed = runner.completedModules || [];
        if (message.moduleId && !completed.includes(message.moduleId)) {
          completed.push(message.moduleId);
        }
        await chrome.storage.local.set({
          pathwayRunner: {
            ...runner,
            completedModules: completed,
            lastCompletedAt: Date.now()
          }
        });

        // Close player tab safely
        if (playerTabId) {
          setTimeout(() => {
            chrome.tabs.remove(playerTabId).catch(() => {});
          }, 1500);
        }

        // Find and activate the Pathway dashboard tab
        let pathwayTab = null;
        if (runner.pathwayTabId) {
          try {
            pathwayTab = await chrome.tabs.get(runner.pathwayTabId);
          } catch (e) {}
        }
        if (!pathwayTab) {
          const tabs = await chrome.tabs.query({
            url: ['*://*.futureskillsprime.in/iDH/fsp/Dashboard/Products_detail/*']
          });
          if (tabs.length > 0) pathwayTab = tabs[0];
        }

        if (pathwayTab && pathwayTab.id) {
          await chrome.tabs.update(pathwayTab.id, { active: true });
          // Reload pathway tab after 2.5s so backend has committed completion
          setTimeout(() => {
            chrome.tabs.reload(pathwayTab.id);
          }, 2500);
        }
      }
    });

    sendResponse({ success: true });
    return true;
  }

  // 4. Stop Pathway Automation completely
  if (message.action === 'STOP_PATHWAY') {
    chrome.storage.local.remove(['pathwayRunner', 'autoResumeCourse']);
    sendResponse({ success: true });
    return true;
  }
});
