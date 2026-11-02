// Elements
const btnStart = document.getElementById('btnStart');
const btnCapture = document.getElementById('btnCapture');
const btnStop = document.getElementById('btnStop');
const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const platformBadge = document.getElementById('platformBadge');
const logOutput = document.getElementById('logOutput');

function appendLog(text, type = 'info') {
  const entry = document.createElement('div');
  const typeClass = type === 'error' ? 'text-error' : (type === 'warn' ? 'text-warn' : 'text-info');
  entry.className = `stream-row ${typeClass}`;
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `${time} ${text}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function updateUI(isRunning) {
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

// Check initial status on popup open
sendTabMessage('GET_STATUS').then((response) => {
  if (response) {
    if (response.platformName && platformBadge) {
      platformBadge.textContent = response.platformName;
    }
    if (response.isRunning !== undefined) {
      updateUI(response.isRunning);
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
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: () => {
            if (window.AutomatorCore && typeof window.AutomatorCore.captureAndSendPage === 'function') {
              window.AutomatorCore.captureAndSendPage();
            }
          }
        });
        appendLog('DOM snapshots delivered to bridge.', 'info');
      } else {
        await sendTabMessage('CAPTURE_PAGE');
      }
    } catch (e) {
      await sendTabMessage('CAPTURE_PAGE');
    }
  });
}

btnStart.addEventListener('click', async () => {
  appendLog('Dispatching start instruction...', 'info');
  updateUI(true);
  const res = await sendTabMessage('START_AUTOMATION');
  if (!res) {
    updateUI(false);
    appendLog('Tab unready. Refresh target page and re-engage.', 'warn');
  }
});

btnStop.addEventListener('click', async () => {
  appendLog('Terminating automation...', 'warn');
  await chrome.storage.local.remove(['springboardRunning', 'pathwayRunner', 'autoResumeCourse']);
  await sendTabMessage('STOP_AUTOMATION');
  chrome.runtime.sendMessage({ action: 'STOP_PATHWAY' }).catch(() => {});
  updateUI(false);
});
