// Elements
const btnStart = document.getElementById('btnStart');
const btnCapture = document.getElementById('btnCapture');
const btnStop = document.getElementById('btnStop');
const masterToggle = document.getElementById('masterToggle');
const masterToggleLabel = document.getElementById('masterToggleLabel');
const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const platformBadge = document.getElementById('platformBadge');
const logOutput = document.getElementById('logOutput');
const apiKeyInput = document.getElementById('apiKeyInput');
const btnSaveKey = document.getElementById('btnSaveKey');
const btnOpenGeminiTab = document.getElementById('btnOpenGeminiTab');

if (btnOpenGeminiTab) {
  btnOpenGeminiTab.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
    appendLog('Opened Gemini tab for free browser AI solving.', 'info');
  });
}

if (apiKeyInput && btnSaveKey) {
  chrome.storage.local.get(['geminiApiKey'], (res) => {
    if (res?.geminiApiKey) {
      apiKeyInput.value = res.geminiApiKey;
    }
  });

  btnSaveKey.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    await chrome.storage.local.set({ geminiApiKey: key });
    appendLog(key ? 'Gemini AI API key saved.' : 'Gemini AI API key cleared.', 'info');
  });
}

function appendLog(text, type = 'info') {
  const entry = document.createElement('div');
  const typeClass = type === 'error' ? 'text-error' : (type === 'warn' ? 'text-warn' : 'text-info');
  entry.className = `stream-row ${typeClass}`;
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `${time} ${text}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function updateUI(isRunning, isExtensionEnabled = true) {
  if (!isExtensionEnabled) {
    if (masterToggle) masterToggle.checked = false;
    if (masterToggleLabel) {
      masterToggleLabel.textContent = 'OFF';
      masterToggleLabel.className = 'master-toggle-label';
    }
    statusBadge.textContent = 'Disabled';
    if (statusDot) statusDot.className = 'beacon-dot';
    btnStart.disabled = true;
    btnStop.disabled = true;
    if (btnCapture) btnCapture.disabled = true;
    return;
  }

  // Extension is enabled
  if (masterToggle) masterToggle.checked = true;
  if (masterToggleLabel) {
    masterToggleLabel.textContent = 'ON';
    masterToggleLabel.className = 'master-toggle-label active';
  }
  if (btnCapture) btnCapture.disabled = false;

  if (isRunning) {
    statusBadge.textContent = 'Active';
    if (statusDot) statusDot.className = 'beacon-dot running';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    statusBadge.textContent = 'Ready';
    if (statusDot) statusDot.className = 'beacon-dot';
    btnStart.disabled = false;
    btnStop.disabled = true;
  }
}

// Sync initial status immediately from storage
chrome.storage.local.get(['speedoRunning', 'speedoExtensionEnabled'], (res) => {
  const isExtensionEnabled = res?.speedoExtensionEnabled !== false; // Default: true (Enabled)
  const isRunning = isExtensionEnabled && Boolean(res?.speedoRunning);
  updateUI(isRunning, isExtensionEnabled);
});

// React live to cross-tab storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.speedoRunning || changes.speedoExtensionEnabled)) {
    chrome.storage.local.get(['speedoRunning', 'speedoExtensionEnabled'], (res) => {
      const isExtensionEnabled = res?.speedoExtensionEnabled !== false;
      const isRunning = isExtensionEnabled && Boolean(res?.speedoRunning);
      updateUI(isRunning, isExtensionEnabled);
    });
  }
});

// Listen for live logs sent from the content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'POPUP_LOG' && message.payload) {
    appendLog(message.payload.text, message.payload.type);
  }
});

// Send command to the active tab's content script with auto-injection fallback
async function sendTabMessage(action, payload = {}) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      appendLog('No active tab detected.', 'error');
      return null;
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { action, payload });
    } catch (msgErr) {
      if (msgErr.message.includes('Receiving end does not exist') || msgErr.message.includes('Could not establish connection')) {
        appendLog('Binding runtime to active tab...', 'info');
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content.css']
        }).catch(() => {});
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
        return await chrome.tabs.sendMessage(tab.id, { action, payload });
      }
      throw msgErr;
    }
  } catch (error) {
    appendLog(`Interface error: ${error.message}`, 'error');
    return null;
  }
}

// Check initial platform details on popup open
sendTabMessage('GET_STATUS').then((response) => {
  if (response) {
    if (response.platformName && platformBadge) {
      platformBadge.textContent = response.platformName;
    }
    const label = btnStart.querySelector('span') || btnStart;
    if (response.isPathway) {
      label.textContent = 'Execute Pathway';
      appendLog(`[${response.platformName}] Pathway ready.`, 'info');
    } else if (response.isPlayer) {
      label.textContent = 'Execute Course';
      appendLog(`[${response.platformName}] Viewer session active.`, 'info');
    } else {
      label.textContent = 'Start Automation';
      appendLog(`Engine attached: ${response.platformName || 'Ready'}`, 'info');
    }
  } else if (platformBadge) {
    platformBadge.textContent = 'Standby';
  }
});

if (btnCapture) {
  btnCapture.addEventListener('click', async () => {
    appendLog('Exporting DOM snapshot (all frames)...', 'info');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: () => ({
            url: window.location.href,
            title: document.title,
            html: document.documentElement.outerHTML
          })
        });

        if (Array.isArray(results) && results.length > 0) {
          for (const frame of results) {
            if (frame && frame.result && frame.result.html) {
              chrome.runtime.sendMessage({
                action: 'SEND_DEBUG_DUMP',
                payload: frame.result
              }).catch(() => {});
            }
          }
          appendLog('DOM snapshots delivered to bridge.', 'info');
        } else {
          await sendTabMessage('CAPTURE_PAGE');
        }
      } else {
        await sendTabMessage('CAPTURE_PAGE');
      }
    } catch (e) {
      await sendTabMessage('CAPTURE_PAGE');
    }
  });
}

// Universal halt routine
async function haltAllAutomations(reason = 'Automation stopped.') {
  await chrome.storage.local.remove([
    'springboardRunning',
    'pathwayRunner',
    'autoResumeCourse',
    'speedoRunning',
    'speedo_quiz_running',
    'speedo_last_quiz_completed'
  ]);

  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id) {
        chrome.tabs.sendMessage(t.id, { action: 'STOP_AUTOMATION' }).catch(() => {});
        chrome.scripting.executeScript({
          target: { tabId: t.id, allFrames: true },
          func: (msg) => {
            if (window.AutomatorCore && typeof window.AutomatorCore.stop === 'function') {
              window.AutomatorCore.stop(msg);
            }
          },
          args: [reason]
        }).catch(() => {});
      }
    }
  } catch (e) {}

  chrome.runtime.sendMessage({ action: 'STOP_PATHWAY' }).catch(() => {});
}

// Master Toggle: Enables or disables the extension itself (does NOT run course)
if (masterToggle) {
  masterToggle.addEventListener('change', async () => {
    const isEnabled = masterToggle.checked;
    await chrome.storage.local.set({ speedoExtensionEnabled: isEnabled });

    if (!isEnabled) {
      appendLog('Extension disabled. All operations halted.', 'warn');
      await haltAllAutomations('Extension disabled by user via toggle switch.');
      updateUI(false, false);
    } else {
      appendLog('Extension enabled. Ready for command.', 'info');
      updateUI(false, true);
    }
  });
}

// Start Automation button: Actually begins doing the course
btnStart.addEventListener('click', async () => {
  appendLog('Starting course automation...', 'info');
  updateUI(true, true);

  await chrome.storage.local.set({
    speedoExtensionEnabled: true,
    speedoRunning: true,
    springboardRunning: true,
    startTime: Date.now()
  });

  const res = await sendTabMessage('START_AUTOMATION');
  if (!res) {
    appendLog('Tab unready. Refresh target page and re-engage.', 'warn');
  }
});

// Halt button: Stops course automation (extension stays enabled)
btnStop.addEventListener('click', async () => {
  appendLog('Halting automation across all tabs and frames...', 'warn');
  await haltAllAutomations('Automation stopped by user.');
  updateUI(false, true);
});
