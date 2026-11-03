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

        console.log(`[Course Automator] Auto-injected into Tab ${tab.id}`);
      } catch (err) {
        console.warn(`[Course Automator] Could not auto-inject tab ${tab.id}:`, err);
      }
    }
  } catch (error) {
    console.error('[Course Automator] onInstalled injection failed:', error);
  }
});

let activeAiTabId = null;
let isCreatingAiTab = false;

async function getOrCreateAiTab() {
  if (activeAiTabId) {
    try {
      const t = await chrome.tabs.get(activeAiTabId);
      if (t) return t;
    } catch (e) {
      activeAiTabId = null;
    }
  }

  const existing = await chrome.tabs.query({
    url: ['*://gemini.google.com/*', '*://chatgpt.com/*']
  });

  if (existing.length > 0) {
    activeAiTabId = existing[0].id;
    // Clean up any extraneous duplicate tabs that were accidentally spawned
    if (existing.length > 1) {
      for (let i = 1; i < existing.length; i++) {
        chrome.tabs.remove(existing[i].id).catch(() => {});
      }
    }
    return existing[0];
  }

  if (isCreatingAiTab) {
    while (isCreatingAiTab) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (activeAiTabId) {
      try { return await chrome.tabs.get(activeAiTabId); } catch (e) {}
    }
  }

  isCreatingAiTab = true;
  try {
    const doubleCheck = await chrome.tabs.query({
      url: ['*://gemini.google.com/*', '*://chatgpt.com/*']
    });
    if (doubleCheck.length > 0) {
      activeAiTabId = doubleCheck[0].id;
      return doubleCheck[0];
    }

    const newTab = await chrome.tabs.create({
      url: 'https://gemini.google.com/app',
      active: false
    });
    activeAiTabId = newTab.id;

    await new Promise((resolve) => {
      const listener = (tid, info) => {
        if (tid === newTab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 8000);
    });
    await new Promise((r) => setTimeout(r, 2000));
    return newTab;
  } finally {
    isCreatingAiTab = false;
  }
}

// Helper: Automate open Gemini / ChatGPT web tab with zero API key
async function solveViaAiWebTab(promptText, isMulti) {
  const targetTab = await getOrCreateAiTab();
  if (!targetTab || !targetTab.id) {
    return { success: false, error: 'Could not acquire AI web tab.' };
  }
  const isGemini = (targetTab.url || '').includes('gemini.google.com') || (targetTab.pendingUrl || '').includes('gemini.google.com');

  const execResults = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    func: async (prompt, isGeminiTarget) => {
      function findInputElement() {
        if (isGeminiTarget) {
          const rich = document.querySelector('rich-textarea');
          if (rich) {
            const ed = rich.querySelector('div[contenteditable="true"], p, textarea');
            if (ed) return ed;
          }
          return document.querySelector('div[contenteditable="true"], textarea.text-input, textarea');
        } else {
          return document.querySelector('#prompt-textarea, textarea, div[contenteditable="true"]');
        }
      }

      const input = findInputElement();
      if (!input) {
        return { success: false, error: 'AI prompt input not found. Ensure account is signed in.' };
      }

      const prevResponses = document.querySelectorAll(
        isGeminiTarget 
          ? '.model-response-text, message-content, [class*="response-container"], .markdown'
          : '[data-message-author-role="assistant"], .markdown'
      );
      const prevCount = prevResponses.length;

      input.focus();
      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        input.innerHTML = `<p>${prompt.replace(/\n/g, '<br>')}</p>`;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      }

      await new Promise((r) => setTimeout(r, 250));

      function findSendButton() {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find((b) => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const testid = (b.getAttribute('data-testid') || '').toLowerCase();
          const cls = (b.className || '').toLowerCase();
          return (
            aria.includes('send') || 
            testid.includes('send') || 
            cls.includes('send') || 
            aria.includes('submit')
          ) && !b.disabled;
        });
      }

      const sendBtn = findSendButton();
      if (sendBtn) {
        sendBtn.click();
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }

      const startTime = Date.now();
      let lastText = '';

      while (Date.now() - startTime < 25000) {
        await new Promise((r) => setTimeout(r, 700));

        const stopBtn = document.querySelector('button[aria-label*="Stop" i], [data-testid="stop-button"]');
        if (stopBtn) continue;

        const currentResponses = document.querySelectorAll(
          isGeminiTarget 
            ? '.model-response-text, message-content, [class*="response-container"], .markdown'
            : '[data-message-author-role="assistant"], .markdown'
        );

        if (currentResponses.length > prevCount) {
          const latest = currentResponses[currentResponses.length - 1];
          const text = (latest.innerText || latest.textContent || '').trim();
          if (text.length > 0) {
            lastText = text;
            await new Promise((r) => setTimeout(r, 500));
            const settled = (latest.innerText || latest.textContent || '').trim();
            return { success: true, text: settled || lastText };
          }
        }
      }

      if (lastText) {
        return { success: true, text: lastText };
      }
      return { success: false, error: 'Response generation timed out on AI web tab.' };
    },
    args: [promptText, isGemini]
  });

  return execResults?.[0]?.result || { success: false, error: 'Tab execution failed.' };
}

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

  // 1b. Close Sender Tab on demand
  if (message.action === 'CLOSE_CURRENT_TAB') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'No sender tab found' });
    }
    return true;
  }

  // 1c. Close all Quiz tabs across FutureSkills
  if (message.action === 'CLOSE_QUIZ_TABS') {
    chrome.tabs.query({ url: '*://*.futureskillsprime.in/LX/quizzes/*' }).then(tabs => {
      for (const t of tabs) {
        chrome.tabs.remove(t.id).catch(() => {});
      }
      sendResponse({ success: true });
    }).catch(() => {
      sendResponse({ success: false });
    });
    return true;
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
                    try { p.muted(true); } catch (e) {}
                    if (p.duration && p.duration()) {
                      try { p.currentTime(p.duration() - 0.1); } catch (e) {}
                    }
                    try { p.trigger('timeupdate'); } catch (e) {}
                    try { p.trigger('ended'); } catch (e) {}
                    try { p.pause(); } catch (e) {}
                  }
                });
              } catch (e) {}
            }
            try {
              document.querySelectorAll('video, audio').forEach(v => {
                v.muted = true;
                v.volume = 0;
                try { v.pause(); } catch (e) {}
              });
            } catch (e) {}
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
          } else if (command === 'EXECUTE_HANDSON') {
            const btn = document.getElementById('focus_execute_handson') || 
                        document.querySelector('button[aria-label="execute code pane text"]');
            if (btn) {
              console.log('[MAIN World] Clicking Run (execute) on Hands-on exercise');
              btn.click();
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

  // Pre-warm Gemini tab silently in background
  if (message.action === 'PREWARM_AI_TAB') {
    getOrCreateAiTab().catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  // 5. Intelligent Question Solver (Direct API or Browser Web Tab Bridge)
  if (message.action === 'SOLVE_WITH_AI') {
    const { question, options, isMulti } = message.payload || {};
    const expectsMulti = isMulti || (question && /select all|choose all|multiple/i.test(question));
    const promptText = expectsMulti
      ? `Solve this assessment question. Select ALL correct option indices (0-based).\nQuestion: ${question}\nOptions:\n${(options || []).map((o, idx) => `${idx}: ${o}`).join('\n')}\nRespond with ONLY the comma-separated correct indices (e.g., "0, 2" or "1").`
      : `Solve this multiple choice question. Select the single best option index (0-based).\nQuestion: ${question}\nOptions:\n${(options || []).map((o, idx) => `${idx}: ${o}`).join('\n')}\nRespond with ONLY the single digit of the correct option index (e.g., 0 or 1 or 2).`;

    chrome.storage.local.get(['geminiApiKey'], async (res) => {
      const apiKey = res?.geminiApiKey;

      // Tier 2A: Direct In-Browser Gemini API (if user configured API key)
      if (apiKey) {
        try {
          const apiResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: promptText }] }],
              generationConfig: { temperature: 0.0, maxOutputTokens: 20 }
            })
          });
          const data = await apiResp.json();
          const rawAnswer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          const matches = [...rawAnswer.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
          if (matches.length > 0) {
            sendResponse({ success: true, answerIndex: matches[0], answerIndices: matches, method: 'gemini_api' });
            return;
          }
        } catch (apiErr) {
          console.warn('[ServiceWorker] Direct API failed, falling back to Web Tab:', apiErr.message);
        }
      }

      // Tier 2B: Free Browser Web Tab Bridge (gemini.google.com / chatgpt.com)
      try {
        const tabResult = await solveViaAiWebTab(promptText, expectsMulti);
        if (tabResult && tabResult.success && tabResult.text) {
          const matches = [...tabResult.text.matchAll(/\d+/g)].map(m => parseInt(m[0], 10));
          if (matches.length > 0) {
            sendResponse({ success: true, answerIndex: matches[0], answerIndices: matches, method: 'web_tab' });
            return;
          }
        }
        sendResponse({ success: false, reason: tabResult?.error || 'WEB_TAB_PARSE_FAILED' });
      } catch (tabErr) {
        sendResponse({ success: false, error: tabErr.message });
      }
    });
    return true; // async sendResponse
  }
});
