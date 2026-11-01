// Elements
const btnStart = document.getElementById('btnStart');
const btnCapture = document.getElementById('btnCapture');
const btnStop = document.getElementById('btnStop');
const statusBadge = document.getElementById('statusBadge');
const platformBadge = document.getElementById('platformBadge');
const logOutput = document.getElementById('logOutput');

function appendLog(text, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function updateUI(isRunning) {
  if (isRunning) {
    statusBadge.textContent = 'Running';
    statusBadge.className = 'badge badge-running';
    btnStart.disabled = true;
    btnStop.disabled = false;
  } else {
    statusBadge.textContent = 'Ready';
    statusBadge.className = 'badge badge-idle';
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
      appendLog('No active tab found.', 'error');
      return null;
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, { action, payload });
    } catch (msgErr) {
      // If content script was disconnected or missing, auto-inject it live!
      if (msgErr.message.includes('Receiving end does not exist') || msgErr.message.includes('Could not establish connection')) {
        appendLog('Re-connecting to tab live...', 'info');
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
        // Retry message after instant injection
        return await chrome.tabs.sendMessage(tab.id, { action, payload });
      }
      throw msgErr;
    }
  } catch (error) {
    appendLog(`Communication error: ${error.message}`, 'error');
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
    if (response.isPathway) {
      btnStart.innerHTML = '<span>🚀 Auto-Complete Entire Pathway</span>';
      appendLog(`[${response.platformName}] Pathway Dashboard detected! Ready.`, 'info');
    } else if (response.isPlayer) {
      btnStart.innerHTML = '<span>🚀 Auto-Complete Current Course</span>';
      appendLog(`[${response.platformName}] Course Player detected! Ready.`, 'info');
    } else {
      btnStart.innerHTML = `<span>🚀 Start ${response.platformName || 'Course'} Automator</span>`;
      appendLog(`Platform ready: ${response.platformName || 'Generic'}`, 'info');
    }
  } else if (platformBadge) {
    platformBadge.textContent = 'Standby';
  }
});

btnCapture.addEventListener('click', async () => {
  appendLog('Capturing page and sending to AI...', 'info');
  const res = await sendTabMessage('CAPTURE_PAGE');
  if (res && res.success) {
    appendLog('✅ Page successfully captured & sent to AI!', 'info');
  } else {
    appendLog('Failed to capture page. Ensure you are on the course tab.', 'error');
  }
});

btnStart.addEventListener('click', async () => {
  appendLog('Sending start command to page...', 'info');
  updateUI(true);
  const res = await sendTabMessage('START_AUTOMATION');
  if (!res) {
    updateUI(false);
    appendLog('Make sure you are on the course page and refresh if needed.', 'warn');
  }
});

btnStop.addEventListener('click', async () => {
  appendLog('Stopping automation...', 'warn');
  await sendTabMessage('STOP_AUTOMATION');
  chrome.runtime.sendMessage({ action: 'STOP_PATHWAY' }).catch(() => {});
  chrome.storage.local.remove(['pathwayRunner', 'autoResumeCourse']);
  updateUI(false);
});
