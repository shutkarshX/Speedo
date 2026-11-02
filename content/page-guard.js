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

  // 4. Intercept assessment and quiz API responses to capture answer payloads
  function extractAssessmentAnswers(payload) {
    const extracted = [];
    function scan(obj) {
      if (!obj || typeof obj !== 'object') return;
      const qText = obj.question || obj.questionText || obj.title || obj.problemText || obj.problem_statement || obj.q_title;
      const options = obj.options || obj.choices || obj.answers || obj.optionList;

      if (typeof qText === 'string' && qText.length > 3 && Array.isArray(options) && options.length > 0) {
        const correctIndices = [];
        const correctTexts = [];

        if (obj.correctAnswer !== undefined) {
          if (typeof obj.correctAnswer === 'number') correctIndices.push(obj.correctAnswer);
          else if (typeof obj.correctAnswer === 'string') correctTexts.push(obj.correctAnswer);
          else if (Array.isArray(obj.correctAnswer)) correctTexts.push(...obj.correctAnswer);
        }
        if (obj.correct_answer !== undefined) {
          if (typeof obj.correct_answer === 'number') correctIndices.push(obj.correct_answer);
          else if (typeof obj.correct_answer === 'string') correctTexts.push(obj.correct_answer);
          else if (Array.isArray(obj.correct_answer)) correctTexts.push(...obj.correct_answer);
        }
        if (obj.answerKey !== undefined) {
          if (Array.isArray(obj.answerKey)) correctIndices.push(...obj.answerKey);
          else correctIndices.push(obj.answerKey);
        }
        if (obj.answer !== undefined && typeof obj.answer !== 'object') {
          if (typeof obj.answer === 'number') correctIndices.push(obj.answer);
          else if (typeof obj.answer === 'string') correctTexts.push(obj.answer);
        }

        options.forEach((opt, idx) => {
          if (opt && typeof opt === 'object') {
            if (opt.isCorrect || opt.is_correct || opt.correct || opt.isAnswer) {
              correctIndices.push(idx);
              const optText = opt.text || opt.title || opt.value || opt.label;
              if (optText) correctTexts.push(optText);
            }
          }
        });

        const optionStrings = options.map(o => {
          if (typeof o === 'string') return o;
          return o?.text || o?.title || o?.value || o?.label || JSON.stringify(o);
        });

        extracted.push({
          question: qText,
          options: optionStrings,
          correctIndices: [...new Set(correctIndices)],
          correctTexts: [...new Set(correctTexts)]
        });
      }

      if (Array.isArray(obj)) {
        for (const item of obj) scan(item);
      } else {
        for (const key of Object.keys(obj)) {
          if (typeof obj[key] === 'object') scan(obj[key]);
        }
      }
    }

    try { scan(payload); } catch (e) {}
    return extracted;
  }

  function handleInterceptedPayload(url, data) {
    if (!data || typeof data !== 'object') return;
    window.__SPEEDO_ASSESSMENT_DATA__ = data;
    const extracted = extractAssessmentAnswers(data);
    if (extracted.length > 0) {
      console.log(`[SPEEDO Page Guard] Found ${extracted.length} answers in payload from:`, url);
      window.__SPEEDO_EXTRACTED_ANSWERS__ = extracted;
      window.postMessage({ type: 'SPEEDO_ASSESSMENT_ANSWERS_FOUND', url, questions: extracted }, '*');
    } else {
      window.postMessage({ type: 'SPEEDO_ASSESSMENT_LOADED', url, data }, '*');
    }

    try {
      fetch('http://127.0.0.1:8765/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'info',
          message: `[Page Guard Intercept] ${url} (Found ${extracted.length} answers)`
        })
      }).catch(() => {});
    } catch (e) {}
  }

  const isAssessmentUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return lower.includes('iap') || 
           lower.includes('contest') || 
           lower.includes('quiz') || 
           lower.includes('assessment') || 
           lower.includes('question') ||
           lower.includes('submission') ||
           lower.includes('evaluate') ||
           lower.includes('result');
  };

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      if (isAssessmentUrl(url)) {
        const cloned = response.clone();
        cloned.json().then(data => {
          handleInterceptedPayload(url, data);
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const url = this._url || '';
        if (isAssessmentUrl(url)) {
          const data = JSON.parse(this.responseText);
          handleInterceptedPayload(url, data);
        }
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };

  console.log('[SPEEDO] Page Guard active in MAIN world.');
})();
