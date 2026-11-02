/**
 * Platform Adapter: Infosys Springboard (Wingspan / Lex LMS)
 * Supports:
 * - https://infyspringboard.onwingspan.com
 * - Course overview & Table of Contents navigation (/app/toc/...)
 * - Content Viewer automation (/app/viewer/...)
 * - Video.js & HTML5 video instant completion
 * - Hands-on coding exercises fast-skip (remote sandbox bypass)
 * - Article reading & Assessment quizzes
 * - "Mark as Complete" with dynamic Angular Material Dialog confirmation
 * - Strictly forward-only module and unit progression (zero backward jumps, zero skipping)
 * - True Module X of Y Progress Engine (Taste Skill compliant)
 */
(function () {
  const SpringboardAdapter = {
    id: 'springboard',
    name: 'Infosys Springboard',
    description: 'Auto-completes courses, modules, and tests on Infosys Springboard (Wingspan/Lex).',

    matches(url = window.location.href) {
      return url.includes('onwingspan.com') || 
             url.includes('infyspringboard') ||
             url.includes('infosysapps.com') ||
             url.includes('/contest/') ||
             url.includes('/app/toc/lex_') ||
             url.includes('/app/viewer/') ||
             url.includes('/viewer/');
    },

    isTocPage() {
      return window.location.pathname.includes('/app/toc/') || 
             document.querySelector('ws-app-toc') !== null ||
             document.querySelector('ws-widget-toc') !== null;
    },

    isViewerPage() {
      return window.location.pathname.includes('/viewer/') || 
             document.querySelector('ws-app-viewer') !== null ||
             document.querySelector('ws-widget-player-video') !== null ||
             document.querySelector('ws-viewer-toc') !== null ||
             document.querySelector('#focus_submit_handson') !== null;
    },

    isIapContestPage() {
      return window.location.hostname.includes('infosysapps.com') || 
             window.location.pathname.includes('/contest/');
    },

    async init() {
      console.log('[Springboard Adapter] Initialized on Wingspan platform:', window.location.pathname);

      // Listen for parent frame IAP start instruction
      window.addEventListener('message', (event) => {
        if (event.data?.type === 'SPEEDO_START_IAP') {
          console.log('[Springboard Adapter] Received SPEEDO_START_IAP instruction from parent frame.');
          this.runIapContestRunner();
        }
      });

      // Auto-engage immediately when mounted directly inside IAP contest iframe
      if (this.isIapContestPage()) {
        AutomatorCore.notify('Autonomous IAP Contest Runner auto-engaging inside contest iframe.', 'info');
        setTimeout(() => {
          this.runIapContestRunner();
        }, 1200);
        return;
      }

      try {
        const data = await chrome.storage.local.get(['springboardRunning']);
        if (data.springboardRunning) {
          console.log('[Springboard Adapter] Auto-resuming Springboard automator...');
          setTimeout(() => {
            this.start();
          }, 1500);
        }
      } catch (e) {}
    },

    async start() {
      if (AutomatorCore.isRunning) return;
      AutomatorCore.setIsRunning(true);
      await chrome.storage.local.set({ springboardRunning: true });
      chrome.runtime.sendMessage({ action: 'PREWARM_AI_TAB' }).catch(() => {});

      AutomatorCore.showHUD('Analyzing Springboard Course...');
      AutomatorCore.notify('Infosys Springboard Automator started.', 'info');

      try {
        if (this.isIapContestPage()) {
          AutomatorCore.notify('Autonomous IAP Contest Runner initialized inside iframe.', 'info');
          await this.runIapContestRunner();
          return;
        }

        if (this.isTocPage()) {
          AutomatorCore.notify('Course Table of Contents detected. Launching viewer...', 'info');
          await this.handleTocPage();
        }
        
        // Run the main viewer completer loop
        await this.runCourseCompleter();
      } catch (err) {
        AutomatorCore.notify(`Error: ${err.message}`, 'error');
        console.error('[Springboard Adapter] Error:', err);
      } finally {
        AutomatorCore.setIsRunning(false);
      }
    },

    /**
     * Handle Table of Contents / Course Overview page
     */
    async handleTocPage() {
      AutomatorCore.updateHUD('Looking for Start / Resume button...', 10);

      const buttons = Array.from(document.querySelectorAll('button, a'));
      const actionBtn = buttons.find(b => {
        if (b.disabled) return false;
        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        return text === 'start' || text === 'resume' || text === 'start learning' || text === 'continue';
      });

      if (actionBtn) {
        AutomatorCore.notify(`Clicking "${actionBtn.innerText.trim()}" to enter course player...`, 'info');
        actionBtn.click();
        await DomUtils.sleep(2500);
      } else {
        const firstUnit = document.querySelector('mat-tree-node, .toc-unit, .mat-list-item, .resource-item');
        if (firstUnit) {
          firstUnit.click();
          await DomUtils.sleep(2500);
        }
      }
    },

    /**
     * Ensure sidebar is switched away from "Zoiee Tutor" to "Contents" navigation
     */
    async ensureContentsTabActive() {
      try {
        const tabs = Array.from(document.querySelectorAll('div[role="tab"]'));
        const contentsTab = tabs.find(t => (t.innerText || t.textContent || '').toLowerCase().includes('contents'));
        if (contentsTab && !contentsTab.classList.contains('mat-tab-label-active')) {
          AutomatorCore.notify('Switching sidebar from Zoiee Tutor to Contents navigation...', 'info');
          contentsTab.click();
          await DomUtils.sleep(350);
        }
      } catch (e) {}
    },

    /**
     * Check if a TOC node is genuinely completed
     * (has green completed-color badge and NOT an unclicked mark-as-complete button)
     */
    isNodeCompleted(node) {
      if (!node) return false;
      if (node.querySelector('button.mark-as-complete-mini, button[aria-label*="mark as complete" i]')) {
        return false;
      }
      return node.querySelector('.completed-color, mat-icon[aria-label="Progress is complete"]') !== null;
    },

    /**
     * Check if current active unit is completed
     */
    isCurrentUnitCompleted() {
      // 1. If any "Mark as Complete" button exists in the viewer toolbar or DOM, it is NOT complete!
      const markBtn = document.querySelector('button[aria-label*="mark as complete" i], button.mark-as-complete-mini, [mattooltip*="mark as complete" i]');
      if (markBtn && !markBtn.disabled && (markBtn.offsetWidth > 0 || markBtn.getClientRects().length > 0)) {
        const isRefresh = (markBtn.getAttribute('aria-label') || '').toLowerCase().includes('refresh') || 
                          (markBtn.innerText || '').toLowerCase().includes('refresh');
        if (!isRefresh) return false;
      }

      // 2. Check active tree node in TOC
      const activeNode = document.querySelector('mat-tree-node.selected, mat-tree-node.highlight-content, mat-tree-node[aria-selected="true"]');
      if (activeNode) {
        return this.isNodeCompleted(activeNode);
      }

      return false;
    },

    /**
     * Resolves real-time course progress metrics from the TOC tree:
     * Calculates True Progress: Module X of Y (Z%)
     */
    getCourseProgress() {
      const allNodes = Array.from(document.querySelectorAll('mat-tree-node'));
      const folders = allNodes.filter(n => 
        n.getAttribute('level') === '0' || 
        n.querySelector('.toc-expand-icon') !== null || 
        n.hasAttribute('aria-expanded')
      );

      const totalModules = Math.max(1, folders.length);
      const activeIdx = this.getCurrentTocNodeIndex();

      let currentModule = 1;
      let activeModuleTitle = '';

      if (activeIdx !== -1 && allNodes[activeIdx]) {
        let lastFolderIdx = 0;
        for (let i = 0; i <= activeIdx; i++) {
          const fIdx = folders.indexOf(allNodes[i]);
          if (fIdx !== -1) {
            lastFolderIdx = fIdx;
          }
        }
        currentModule = lastFolderIdx + 1;
        activeModuleTitle = (folders[lastFolderIdx]?.querySelector('.content-title')?.innerText || folders[lastFolderIdx]?.innerText || '').replace(/[\n\r]+/g, ' ').trim();
      }

      const percent = Math.min(100, Math.round((currentModule / totalModules) * 100));
      return { currentModule, totalModules, percent, activeModuleTitle };
    },

    /**
     * Master Viewer Completer Loop:
     * High-speed dynamic event-driven advancement:
     * Automatically waits dynamically for elements (0ms wasted hardcoded sleeps).
     */
    async runCourseCompleter() {
      AutomatorCore.notify('Infosys Springboard Dynamic Completer running...', 'info');
      AutomatorCore.showHUD('Infosys Springboard: Completing course...');

      const maxSteps = 300;
      let step = 0;
      let consecutiveStuck = 0;
      let lastUrl = window.location.href;
      let lastTitle = '';

      while (AutomatorCore.isRunning && step < maxSteps) {
        step++;

        // 1. Keep sidebar on Contents tab in background
        this.ensureContentsTabActive().catch(() => {});

        // 2. Identify current unit and calculate true course progress
        const unitTitleEl = document.querySelector('.content-title, .collection-title, h1, .header-title');
        const unitTitle = unitTitleEl ? unitTitleEl.innerText.replace(/[\n\r]+/g, ' ').trim() : `Unit ${step}`;
        
        const progress = this.getCourseProgress();
        const fullDisplayTitle = progress.activeModuleTitle ? 
          `[M${progress.currentModule}/${progress.totalModules}: ${progress.activeModuleTitle}] ${unitTitle}` : 
          `[M${progress.currentModule}/${progress.totalModules}] ${unitTitle}`;

        AutomatorCore.notify(`[Step ${step}] ${fullDisplayTitle}`, 'info');

        // Loop detection: if on exact same URL and title as previous step
        if (window.location.href === lastUrl && unitTitle === lastTitle) {
          consecutiveStuck++;
          if (consecutiveStuck >= 2) {
            AutomatorCore.notify(`[Notice] Repeated step on "${unitTitle}". Advancing forward via TOC...`, 'warn');
            await this.advanceForwardViaToc();
            await this.waitForSlideChange(lastUrl, unitTitle, 2500);
            consecutiveStuck = 0;
            lastUrl = window.location.href;
            lastTitle = unitTitle;
            continue;
          }
        } else {
          consecutiveStuck = 0;
        }
        lastUrl = window.location.href;
        lastTitle = unitTitle;

        // 3. Hands-on coding lab / interactive code check (skip immediately)
        const isHandsOn = window.location.href.includes('/viewer/hands-on/') ||
                          window.location.href.includes('/viewer/coding/') ||
                          window.location.href.includes('/viewer/practice/') ||
                          document.querySelector('ws-viewer-plugin-hands-on, #focus_execute_handson, #focus_submit_handson, .monaco-editor, .ace_editor, [aria-label*="code pane" i]');

        if (isHandsOn) {
          AutomatorCore.notify(`[Skip] Hands-on code exercise "${fullDisplayTitle}". Advancing...`, 'info');
          AutomatorCore.updateHUD(`Bypassing: ${fullDisplayTitle}`, progress.percent);
          if (!AutomatorCore.isRunning) break;
          const advanced = await this.advanceToNextUnit();
          if (!advanced || !AutomatorCore.isRunning) break;
          await this.waitForSlideChange(lastUrl, unitTitle, 3000);
          lastUrl = window.location.href;
          continue;
        }

        // 4. Check if current slide is ALREADY completed
        if (this.isCurrentUnitCompleted()) {
          AutomatorCore.notify(`[Done] Unit "${fullDisplayTitle}" already completed. Advancing...`, 'info');
          AutomatorCore.updateHUD(`Done: ${fullDisplayTitle}`, progress.percent);
          if (!AutomatorCore.isRunning) break;
          const advanced = await this.advanceToNextUnit();
          if (!advanced || !AutomatorCore.isRunning) break;
          await this.waitForSlideChange(lastUrl, unitTitle, 3000);
          lastUrl = window.location.href;
          continue;
        }

        // 5. Unit is INCOMPLETE: Complete it dynamically!
        if (!AutomatorCore.isRunning) break;
        AutomatorCore.updateHUD(`Active: ${fullDisplayTitle}`, progress.percent);

        // A. Start video if present so Mark as Complete unlocks immediately
        await this.handleVideoIfPresent();
        if (!AutomatorCore.isRunning) break;

        // B. Handle Assessment / Quiz
        const iapIframe = document.querySelector('iframe#iap-iframe, iframe[src*="lex-iap"], iframe[src*="/contest/"]');
        if (iapIframe) {
          AutomatorCore.notify('IAP Assessment frame detected. Waiting for assessment solver...', 'info');
          try {
            if (iapIframe.contentWindow) {
              iapIframe.contentWindow.postMessage({ type: 'SPEEDO_START_IAP' }, '*');
            }
          } catch (e) {}
          await this.waitForIapAssessmentCompletion();
          if (!AutomatorCore.isRunning) break;
        } else {
          // Standard slide assessment / quiz
          await this.handleAssessmentIfPresent();
          if (!AutomatorCore.isRunning) break;
        }

        // C. Trigger & confirm "Mark as Complete" dynamically
        await this.markCurrentUnitComplete();
        if (!AutomatorCore.isRunning) break;

        // D. Advance to next unit/module immediately
        const advanced = await this.advanceToNextUnit();
        if (!advanced || !AutomatorCore.isRunning) {
          if (!AutomatorCore.isRunning) break;
          AutomatorCore.notify('Course completed or no more units available.', 'info');
          AutomatorCore.updateHUD('Course Completed', 100);
          AutomatorCore.stop('Course Completed.');
          break;
        }

        // Wait dynamically for next slide to mount (checking both URL and title)
        await this.waitForSlideChange(lastUrl, unitTitle, 3000);
        if (!AutomatorCore.isRunning) break;
        lastUrl = window.location.href;
      }
    },

    /**
     * Dynamically wait for URL or slide title to change after clicking Next
     */
    async waitForSlideChange(previousUrl, previousTitle = '', maxWaitMs = 3000) {
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        if (!AutomatorCore.isRunning) return false;
        const currentTitle = document.querySelector('.content-title, .collection-title, h1, .header-title')?.innerText?.trim() || '';
        if (window.location.href !== previousUrl || (previousTitle && currentTitle && currentTitle !== previousTitle)) {
          await DomUtils.sleep(150); // Allow Angular router outlet to mount
          return true;
        }
        await DomUtils.sleep(50);
      }
      return false;
    },

    /**
     * Start video playback immediately and seek to end so "Mark as Complete" unlocks (0ms wasted)
     */
    async handleVideoIfPresent() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return;

      for (const vid of videos) {
        try {
          vid.muted = true;
          if (vid.duration && !isNaN(vid.duration) && vid.duration > 0) {
            vid.currentTime = Math.max(0, vid.duration - 0.2);
          }
          if (vid.paused) vid.play().catch(() => {});
          vid.dispatchEvent(new Event('play'));
          vid.dispatchEvent(new Event('timeupdate'));
          vid.dispatchEvent(new Event('ended'));
        } catch (e) {}
      }

      // Fast MAIN world event trigger
      AutomatorCore.runInMainWorld('VIDEO_ENDED').catch(() => {});
    },

    /**
     * Locate question containers across Wingspan and IAP contest views
     */
    findQuestionContainers(root = document) {
      const selectors = [
        'ws-widget-player-quiz .quiz-question',
        '.question-view',
        '.contest-question',
        '.question-container',
        '.card-question',
        'mat-card.question',
        'div[class*="question-card"]',
        'div[class*="question-item"]'
      ];
      for (const sel of selectors) {
        const found = Array.from(root.querySelectorAll(sel));
        if (found.length > 0) return found;
      }
      return [];
    },

    /**
     * Solve a single question via:
     * 1. Intercepted Network Answer / Local QA Cache
     * 2. Direct In-Browser Gemini AI Solver
     * 3. Exploratory Selection (first option)
     */
    findIapOptions(root = document) {
      // 1. Standard radio / checkbox elements
      const radios = Array.from(root.querySelectorAll(
        'mat-radio-button, mat-checkbox, input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], .mat-radio-button, .mat-checkbox'
      )).filter(el => el.offsetWidth > 0 || el.getClientRects().length > 0 || el.querySelector('input'));
      if (radios.length >= 2) return radios;

      // 2. Rows directly preceding the Save / Reset action buttons
      const saveBtn = Array.from(root.querySelectorAll('button, [role="button"]')).find(b => {
        const t = (b.innerText || '').trim().toLowerCase();
        return t === 'save';
      });

      if (saveBtn) {
        const card = saveBtn.closest('mat-card, .card, form, div[class*="content"]') || saveBtn.parentElement.parentElement;
        if (card) {
          const rows = Array.from(card.querySelectorAll('div, label, p, li')).filter(el => {
            if (el.contains(saveBtn)) return false;
            if (el.children.length > 3) return false;
            const txt = (el.innerText || '').trim();
            return txt.length > 0 && txt.length < 120 && !txt.includes('Reset') && !txt.includes('Save') && !txt.includes('OBJECTIVE') && !txt.includes('for(');
          });
          const distinct = [];
          for (const r of rows) {
            if (!distinct.some(d => d.contains(r) || r.contains(d))) distinct.push(r);
          }
          if (distinct.length >= 2) return distinct;
        }
      }

      return [];
    },

    clickIapOption(el) {
      if (!el) return;
      try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}

      const input = el.querySelector('input') || (el.tagName === 'INPUT' ? el : null);
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        try { input.click(); } catch (e) {}
      }

      const targets = [el];
      const label = el.querySelector('label') || (el.tagName === 'LABEL' ? el : null);
      if (label) targets.push(label);
      const circle = el.querySelector('.mat-radio-container, .mat-radio-outer-circle, .circle, span') || el.firstElementChild;
      if (circle) targets.push(circle);

      for (const t of targets) {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
          t.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
        });
        try { t.click(); } catch (e) {}
      }
    },

    clickSaveButton(root = document) {
      const saveBtn = Array.from(root.querySelectorAll('button, a, [role="button"], .mat-raised-button, .mat-flat-button')).find(b => {
        if (b.disabled || b.offsetWidth === 0) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'save' || txt === 'save answer' || txt === 'save & next';
      });
      if (saveBtn) {
        AutomatorCore.notify('Saved question response.', 'info');
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
          saveBtn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
        });
        try { saveBtn.click(); } catch (e) {}
        return true;
      }
      return false;
    },

    clickQuestionNumber(qNum, root = document) {
      const targetStr = String(qNum);
      const candidates = Array.from(root.querySelectorAll('button, a, div, span, li, [role="button"]')).filter(el => {
        if (el.children.length > 1) return false;
        const txt = (el.innerText || el.textContent || '').trim();
        return txt === targetStr && (el.offsetWidth > 0 || el.getClientRects().length > 0);
      });

      if (candidates.length > 0) {
        const btn = candidates[0].closest('button, a, [role="button"], div') || candidates[0];
        try { btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {}
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
          btn.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
        });
        try { btn.click(); } catch (e) {}
        return true;
      }
      return false;
    },

    /**
     * Solve a single question via:
     * 1. Intercepted Network Answer / Local QA Cache
     * 2. Direct In-Browser Gemini AI Solver
     * 3. Exploratory Selection (first option)
     */
    async solveSingleQuestion(container = document) {
      let rawQuestion = '';
      const codeEl = container.querySelector('pre, code, div[class*="code"], div[class*="snippet"], .problem-statement, .question-text');
      if (codeEl) {
        rawQuestion = (codeEl.innerText || codeEl.textContent || '').trim();
      }
      if (!rawQuestion || rawQuestion.length < 5) {
        const titleEl = container.querySelector(
          '.question-text, .question-title, .problem-statement, .q-text, .question, h2, h3, h4, [class*="questionText"], [class*="question-desc"], .content-card'
        );
        rawQuestion = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : '';
      }

      const optionEls = this.findIapOptions(container);
      if (optionEls.length === 0) return false;

      const optionTexts = optionEls.map(el => (el.innerText || el.textContent || el.value || '').trim());
      const isMulti = optionEls.some(el => el.matches('mat-checkbox, input[type="checkbox"], [role="checkbox"]'));

      AutomatorCore.notify(`Answering: "${(rawQuestion || 'Question').slice(0, 35)}..." (${optionEls.length} options)`, 'info');

      // Method 1 & 4: Check QA Cache and Network Interception
      if (rawQuestion) {
        const cached = await AutomatorCore.getCachedAnswer(rawQuestion);
        if (cached) {
          let matched = false;
          if (Array.isArray(cached.correctIndices) && cached.correctIndices.length > 0) {
            for (const idx of cached.correctIndices) {
              if (optionEls[idx]) {
                this.clickIapOption(optionEls[idx]);
                matched = true;
              }
            }
          }
          if (!matched && Array.isArray(cached.correctTexts) && cached.correctTexts.length > 0) {
            for (const ansText of cached.correctTexts) {
              const cleanAns = ansText.toLowerCase().trim();
              const foundIdx = optionTexts.findIndex(txt => txt.toLowerCase().includes(cleanAns) || cleanAns.includes(txt.toLowerCase()));
              if (foundIdx >= 0 && optionEls[foundIdx]) {
                this.clickIapOption(optionEls[foundIdx]);
                matched = true;
              }
            }
          }
          if (matched) {
            AutomatorCore.notify('Selected answer from QA cache / network payload.', 'info');
            await DomUtils.sleep(200);
            this.clickSaveButton(container);
            return true;
          }
        }
      }

      // Method 3: Direct In-Browser Gemini AI Solver
      if (rawQuestion && optionTexts.length > 0) {
        try {
          AutomatorCore.notify('Consulting AI solver for correct answer...', 'info');
          const aiRes = await new Promise(resolve => {
            chrome.runtime.sendMessage({
              action: 'SOLVE_WITH_AI',
              payload: { question: rawQuestion, options: optionTexts, isMulti }
            }, resolve);
          });

          if (aiRes && aiRes.success) {
            const methodLabel = aiRes.method === 'web_tab' ? 'Gemini Web Tab' : 'Gemini AI';
            if (Array.isArray(aiRes.answerIndices) && aiRes.answerIndices.length > 0) {
              for (const idx of aiRes.answerIndices) {
                if (optionEls[idx]) this.clickIapOption(optionEls[idx]);
              }
              AutomatorCore.notify(`Answered via ${methodLabel}: options [${aiRes.answerIndices.join(', ')}]`, 'info');
              await AutomatorCore.saveAnswerToCache(rawQuestion, aiRes.answerIndices.map(i => optionTexts[i]), aiRes.answerIndices);
              await DomUtils.sleep(200);
              this.clickSaveButton(container);
              return true;
            } else if (aiRes.answerIndex !== undefined && optionEls[aiRes.answerIndex]) {
              this.clickIapOption(optionEls[aiRes.answerIndex]);
              AutomatorCore.notify(`Answered via ${methodLabel}: option ${aiRes.answerIndex + 1}`, 'info');
              await AutomatorCore.saveAnswerToCache(rawQuestion, [optionTexts[aiRes.answerIndex]], [aiRes.answerIndex]);
              await DomUtils.sleep(200);
              this.clickSaveButton(container);
              return true;
            }
          }
        } catch (aiErr) {
          console.warn('[Springboard Adapter] AI solver failed:', aiErr);
        }
      }

      // Fallback: Exploratory Selection (first option)
      try {
        this.clickIapOption(optionEls[0]);
        AutomatorCore.notify('Selected initial option (feedback loop will record correct answer).', 'info');
        await DomUtils.sleep(200);
        this.clickSaveButton(container);
        return true;
      } catch (e) {}

      return false;
    },

    /**
     * Locate Next / Save & Next button in assessment views
     */
    findNextQuestionButton(root = document) {
      const candidates = Array.from(root.querySelectorAll('button, a, div[role="button"], mat-icon, span'));
      return candidates.find(b => {
        if (b.disabled || b.offsetWidth === 0) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const tooltip = (b.getAttribute('mattooltip') || '').toLowerCase();

        // Never match submit or finish buttons as Next
        if (txt.includes('finish') || txt.includes('submit') || aria.includes('finish') || aria.includes('submit')) {
          return false;
        }

        return txt === 'next' || 
               txt === 'save & next' || 
               txt === 'next question' || 
               txt === 'save and next' || 
               txt === 'next >' ||
               txt.includes('next') ||
               aria.includes('next') ||
               tooltip.includes('next') ||
               txt === 'navigate_next' ||
               txt === 'chevron_right' ||
               txt === 'arrow_forward';
      });
    },

    /**
     * Locate Submit / Finish / Complete button in assessment views (excluding contest finish)
     */
    findSubmitOrFinishButton(root = document) {
      const candidates = Array.from(root.querySelectorAll('button, a, div[role="button"]'));
      return candidates.find(b => {
        if (b.disabled || b.offsetWidth === 0) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        // Never allow generic submit to click "finish test"
        if (txt.includes('finish test')) return false;
        return txt === 'submit' || 
               txt === 'submit assessment' || 
               txt === 'finish' || 
               txt === 'end test' || 
               txt === 'check answer' ||
               aria.includes('submit');
      });
    },

    /**
     * Dedicated button finder for IAP contest final submission
     */
    findContestFinishButton(root = document) {
      const candidates = Array.from(root.querySelectorAll('button, a, div[role="button"]'));
      return candidates.find(b => {
        if (b.disabled || b.offsetWidth === 0) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        return txt === 'finish test' || txt.includes('finish test') || txt === 'submit test' || aria.includes('finish test');
      });
    },

    /**
     * Confirm submit modal dialog if present
     */
    async confirmSubmitDialogIfPresent() {
      await DomUtils.sleep(300);
      const dialogs = document.querySelectorAll('mat-dialog-container, .modal, .dialog, div[role="dialog"]');
      for (const d of dialogs) {
        const btns = Array.from(d.querySelectorAll('button'));
        const confirmBtn = btns.find(b => {
          if (b.disabled) return false;
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          return txt === 'yes' || txt === 'confirm' || txt === 'submit' || txt === 'proceed' || txt === 'ok';
        });
        if (confirmBtn) {
          confirmBtn.click();
          await DomUtils.sleep(400);
          return true;
        }
      }
      return false;
    },

    /**
     * Scrape and persist correct answers from review/result screens (Method 4: Feedback Loop)
     */
    async scrapeAndSaveReviewResults(root = document) {
      const reviewCards = root.querySelectorAll(
        '.review-card, .question-review, .result-item, .solution-item, div[class*="review"], div[class*="result"]'
      );
      if (reviewCards.length === 0) return false;

      let savedCount = 0;
      for (const card of reviewCards) {
        const qEl = card.querySelector('.question-text, .question-title, h3, h4, p');
        const qText = qEl ? (qEl.innerText || qEl.textContent || '').trim() : '';
        if (!qText) continue;

        const correctEl = card.querySelector(
          '.correct-answer, .correct, [aria-label*="correct" i], .text-success, mat-icon[fonticon="check"]'
        );
        const correctText = correctEl ? (correctEl.innerText || correctEl.textContent || '').trim() : '';

        if (correctText) {
          await AutomatorCore.saveAnswerToCache(qText, [correctText]);
          savedCount++;
        }
      }

      if (savedCount > 0) {
        AutomatorCore.notify(`Feedback loop saved ${savedCount} verified answers to QA cache.`, 'info');
        return true;
      }
      return false;
    },

    /**
     * Answer assessment / quiz questions dynamically if present
     */
    async handleAssessmentIfPresent() {
      // Check if we are on a review screen first
      await this.scrapeAndSaveReviewResults();

      const containers = this.findQuestionContainers();
      if (containers.length > 0) {
        AutomatorCore.notify('Assessment question containers identified.', 'info');
        for (const c of containers) {
          await this.solveSingleQuestion(c);
          await DomUtils.sleep(150);
        }
      } else {
        const quizOptions = document.querySelectorAll('mat-radio-button, mat-checkbox, input[type="radio"], input[type="checkbox"]');
        if (quizOptions.length === 0) return;
        AutomatorCore.notify('Assessment options detected. Selecting answers...', 'info');
        await this.solveSingleQuestion(document);
      }

      await DomUtils.sleep(250);

      const submitBtn = this.findSubmitOrFinishButton();
      if (submitBtn && !submitBtn.disabled) {
        try { submitBtn.click(); } catch (e) {}
        await DomUtils.sleep(300);
        await this.confirmSubmitDialogIfPresent();
        await DomUtils.sleep(500);
        await this.scrapeAndSaveReviewResults();
      }
    },

    /**
     * Auto-dismiss the Springboard proctoring fullscreen modal
     * ("Accessible only on fullscreen. Click Okay to continue")
     */
    async dismissProctoringFullscreenWarning() {
      const warningHolders = Array.from(document.querySelectorAll('.proctoring-warning-holder, .proctoring-warning')).filter(el => {
        return el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none';
      });
      const okayBtns = Array.from(document.querySelectorAll('button, .mat-flat-button')).filter(b => {
        if (b.offsetWidth === 0 || b.disabled) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'okay' || txt === 'ok';
      });

      if (warningHolders.length > 0 || okayBtns.length > 0) {
        AutomatorCore.notify('Proctoring warning detected. Dismissing...', 'info');

        for (const btn of okayBtns) {
          try {
            btn.click();
          } catch (e) {}
        }

        warningHolders.forEach(holder => {
          holder.style.setProperty('display', 'none', 'important');
          holder.remove();
        });

        await DomUtils.sleep(200);
        return true;
      }
      return false;
    },

    /**
     * Autonomous IAP Contest Runner (Runs inside the IAP assessment iframe)
     */
    async runIapContestRunner() {
      if (this._isIapRunnerRunning) {
        console.log('[Springboard Adapter] IAP Runner already active, skipping duplicate invocation.');
        return;
      }
      this._isIapRunnerRunning = true;
      AutomatorCore.setIsRunning(true);

      try {
        try {
          await chrome.storage.local.set({ springboardRunning: true });
        } catch (e) {}

        AutomatorCore.showHUD('SPEEDO Assessment Solver Active');
        AutomatorCore.notify('Engaging IAP Contest Runner inside iframe...', 'info');

        // Dismiss proctoring warning if present
        await this.dismissProctoringFullscreenWarning();

        // Capture page DOM to debug server immediately on start
        try {
          await AutomatorCore.captureAndSendPage();
        } catch (e) {}

        const areQuestionsMounted = () => {
          const optionInputs = document.querySelectorAll(
            'mat-radio-button, mat-checkbox, input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"], .mat-radio-button, .mat-checkbox'
          );
          return optionInputs.length > 0;
        };

        const findAnyStartOrAttemptElement = () => {
          // 1. Search true interactive buttons and links first
          const buttons = Array.from(document.querySelectorAll(
            'button, a, [role="button"], .mat-raised-button, .mat-flat-button, .mat-button, input[type="button"], input[type="submit"]'
          ));
          for (const b of buttons) {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            if (txt.includes('attempt') || txt === 'start' || txt === 'start test' || txt === 'begin' || txt === 'continue' || txt === 'resume') {
              return b;
            }
          }

          // 2. Pure text leaf search (elements with NO child elements)
          const allLeaves = Array.from(document.querySelectorAll('*')).filter(el => el.children.length === 0);
          for (const leaf of allLeaves) {
            const txt = (leaf.innerText || leaf.textContent || '').trim().toLowerCase();
            if (txt.includes('attempt section') || txt === 'attempt' || txt === 'attempt test') {
              const clickable = leaf.closest('button, a, [role="button"], mat-card, .card, div[class*="btn"], div[class*="action"]') || leaf;
              return clickable;
            }
          }

          // 3. Leaf fallback for start / begin
          for (const leaf of allLeaves) {
            const txt = (leaf.innerText || leaf.textContent || '').trim().toLowerCase();
            if (txt === 'start' || txt === 'start assessment' || txt === 'begin test' || txt === 'start test' || txt === 'take test') {
              const clickable = leaf.closest('button, a, [role="button"], mat-card, .card') || leaf;
              return clickable;
            }
          }

          return null;
        };

        // 1. Enter section / Start test if questions are not yet visible
        if (!areQuestionsMounted()) {
          const allTextOnPage = Array.from(document.querySelectorAll('button, a, [role="button"], .mat-flat-button, .mat-raised-button, .btn'))
            .map(b => (b.innerText || b.textContent || '').trim().replace(/\s+/g, ' '))
            .filter(t => t.length > 0 && t.length < 40);
          console.log('[SPEEDO IAP] Detected buttons on page:', allTextOnPage);
          if (allTextOnPage.length > 0) {
            AutomatorCore.notify(`Buttons on screen: [${allTextOnPage.slice(0, 5).join(' | ')}]`, 'info');
          }

          const startBtn = findAnyStartOrAttemptElement();
          if (startBtn) {
            const label = (startBtn.innerText || startBtn.textContent || 'Attempt Section').trim().replace(/\s+/g, ' ');
            AutomatorCore.notify(`Clicking "${label.slice(0, 30)}"...`, 'info');
            try { startBtn.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}

            const targets = [startBtn];
            if (startBtn.querySelector('.mat-button-wrapper')) targets.push(startBtn.querySelector('.mat-button-wrapper'));
            if (startBtn.firstElementChild) targets.push(startBtn.firstElementChild);

            for (const t of targets) {
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
                t.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
              });
              try { t.click(); } catch (e) {}
            }

            await DomUtils.sleep(2500);
            await this.dismissProctoringFullscreenWarning();
          } else {
            AutomatorCore.notify('Waiting for section Attempt button to render...', 'info');
            await DomUtils.sleep(1500);
          }
        }

        // 2. Sequentially solve through questions 1..20
        const answeredQuestions = new Set();
        const totalQuestions = 20;

        for (let q = 1; q <= totalQuestions; q++) {
          if (!AutomatorCore.isRunning) break;
          await this.dismissProctoringFullscreenWarning();

          // Check if review screen already appeared
          if (await this.scrapeAndSaveReviewResults()) {
            AutomatorCore.notify('IAP Assessment complete. Correct answers indexed.', 'info');
            try { window.parent.postMessage({ type: 'SPEEDO_IAP_COMPLETED' }, '*'); } catch (e) {}
            return;
          }

          // Navigate to Question q
          AutomatorCore.notify(`Opening Question ${q}/${totalQuestions}...`, 'info');
          this.clickQuestionNumber(q);
          await DomUtils.sleep(800);

          // Solve question q
          const answered = await this.solveSingleQuestion(document);
          if (answered) {
            answeredQuestions.add(q);
          }

          AutomatorCore.updateHUD(
            `Solved ${answeredQuestions.size}/${totalQuestions} Questions`,
            Math.round((q / totalQuestions) * 100)
          );

          // Ensure Save is clicked
          await DomUtils.sleep(300);
          this.clickSaveButton(document);
          await DomUtils.sleep(500);
        }

        // 3. All 20 questions completed! Submit contest
        AutomatorCore.notify('All 20 questions completed. Submitting IAP contest...', 'info');
        const submitBtn = this.findContestFinishButton();
        if (submitBtn && !submitBtn.disabled) {
          const submitTarget = submitBtn.closest('button, a, div[role="button"]') || submitBtn;
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(evt => {
            submitTarget.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
          });
          try { submitTarget.click(); } catch (e) {}
          await DomUtils.sleep(600);
          await this.confirmSubmitDialogIfPresent();
          await DomUtils.sleep(2500);
          await this.scrapeAndSaveReviewResults();
          try { window.parent.postMessage({ type: 'SPEEDO_IAP_COMPLETED' }, '*'); } catch (e) {}
          return;
        }
      } finally {
        this._isIapRunnerRunning = false;
      }
    },

    /**
     * Parent frame waiter for nested IAP contest completion
     */
    async waitForIapAssessmentCompletion(maxWaitMs = 180000) {
      window.__SPEEDO_IAP_FINISHED__ = false;
      const startTime = Date.now();
      AutomatorCore.notify('Waiting for IAP contest completion...', 'info');

      // Send start instruction ONCE to child frame
      try {
        const frame = document.querySelector('iframe#iap-iframe, iframe[src*="lex-iap"], iframe[src*="/contest/"]');
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'SPEEDO_START_IAP' }, '*');
        }
      } catch (e) {}

      while (Date.now() - startTime < maxWaitMs) {
        if (!AutomatorCore.isRunning) return false;

        // Auto-dismiss proctoring warning in parent frame
        await this.dismissProctoringFullscreenWarning();

        if (window.__SPEEDO_IAP_FINISHED__) {
          AutomatorCore.notify('IAP assessment finished.', 'info');
          return true;
        }

        await DomUtils.sleep(1500);
      }
      return false;
    },

    /**
     * Dynamically wait for "Mark as Complete" button to mount
     */
    async waitForMarkButton(maxWaitMs = 1500) {
      const startTime = Date.now();
      const markSelectors = [
        'button[aria-label*="mark as complete" i]',
        'button.mark-as-complete-mini',
        '[mattooltip*="mark as complete" i]',
        'button.mark-complete-btn'
      ];

      while (Date.now() - startTime < maxWaitMs) {
        if (!AutomatorCore.isRunning) return null;
        for (const sel of markSelectors) {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && (btn.offsetWidth > 0 || btn.getClientRects().length > 0)) {
            const isRefresh = (btn.getAttribute('aria-label') || '').toLowerCase().includes('refresh') || 
                              (btn.innerText || '').toLowerCase().includes('refresh');
            if (!isRefresh) return btn;
          }
        }
        await DomUtils.sleep(50);
      }
      return null;
    },

    /**
     * Click Wingspan's "Mark as Complete" button AND confirm the popup modal dialog dynamically
     */
    async markCurrentUnitComplete() {
      // 1. Check if a confirmation dialog is already open on screen
      let confirmBtn = await this.waitForConfirmDialog(250);
      if (confirmBtn) {
        AutomatorCore.notify('Confirming existing "Mark as complete" dialog...', 'info');
        await AutomatorCore.runInMainWorld('CONFIRM_MARK_COMPLETE');
        try { confirmBtn.click(); } catch (e) {}
        await DomUtils.sleep(200);
        return true;
      }

      // 2. Dynamically wait for the Mark as Complete button to mount
      const triggerBtn = await this.waitForMarkButton(1500);
      if (triggerBtn) {
        AutomatorCore.notify('Clicking "Mark as Complete" icon...', 'info');
        await AutomatorCore.runInMainWorld('TRIGGER_MARK_COMPLETE');
        try { triggerBtn.click(); } catch (e) {}

        // 3. Dynamically wait for the confirmation dialog
        confirmBtn = await this.waitForConfirmDialog(2000);
        if (confirmBtn) {
          AutomatorCore.notify('Confirming "Mark as complete" dialog...', 'info');
          await AutomatorCore.runInMainWorld('CONFIRM_MARK_COMPLETE');
          try { confirmBtn.click(); } catch (e) {}
          await DomUtils.sleep(250);
          return true;
        }
      }

      return false;
    },

    /**
     * Polls dynamically for Angular Material confirmation dialog buttons
     */
    async waitForConfirmDialog(maxWaitMs = 2000) {
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        if (!AutomatorCore.isRunning) return null;
        const dialog = document.querySelector('ws-widget-mark-as-complete-dialog, mat-dialog-container, .cdk-overlay-pane');
        if (dialog) {
          const btns = Array.from(dialog.querySelectorAll('button'));
          const confirm = btns.find(b => {
            const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
            return (txt.includes('mark as complete') || txt.includes('yes') || txt.includes('confirm') || txt.includes('ok')) && 
                   !txt.includes('cancel');
          });
          if (confirm && !confirm.disabled && (confirm.offsetWidth > 0 || confirm.getClientRects().length > 0)) {
            return confirm;
          }
        }
        await DomUtils.sleep(50);
      }
      return null;
    },

    async confirmAnyOpenDialog() {
      const confirmBtn = await this.waitForConfirmDialog(500);
      if (confirmBtn) {
        await AutomatorCore.runInMainWorld('CONFIRM_MARK_COMPLETE');
        try { confirmBtn.click(); } catch (e) {}
        await DomUtils.sleep(200);
      }
    },

    /**
     * Robust click dispatcher that triggers full mouse/pointer events across Angular CDK tree nodes
     */
    clickTreeNode(node) {
      if (!node) return false;
      try {
        if (typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ block: 'nearest' });
        }
      } catch (e) {}

      const targets = [
        node.querySelector('.content-title'),
        node.querySelector('.expand-button'),
        node.querySelector('ws-viewer-icon'),
        node
      ].filter(Boolean);

      for (const target of targets) {
        try {
          ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
            target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          });
          target.click();
        } catch (e) {}
      }

      return true;
    },

    /**
     * Expands a collapsed module folder in the TOC and waits dynamically for it to expand
     */
    async expandFolder(folderNode) {
      if (!folderNode || folderNode.getAttribute('aria-expanded') === 'true') {
        return true;
      }

      const expander = folderNode.querySelector('.expand-button') || 
                       folderNode.querySelector('.toc-expand-icon') || 
                       folderNode;

      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
        expander.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
      try { expander.click(); } catch (e) {}

      const startTime = Date.now();
      while (Date.now() - startTime < 2500) {
        if (!AutomatorCore.isRunning) return false;
        if (folderNode.getAttribute('aria-expanded') === 'true') {
          await DomUtils.sleep(150);
          return true;
        }
        await DomUtils.sleep(50);
      }
      return false;
    },

    /**
     * Resolves the current active TOC tree node index in document.querySelectorAll('mat-tree-node')
     */
    getCurrentTocNodeIndex() {
      const allNodes = Array.from(document.querySelectorAll('mat-tree-node'));
      if (allNodes.length === 0) return -1;

      // 1. Direct class or aria match on node or inside node
      let activeIdx = allNodes.findIndex(n => 
        n.classList.contains('selected') || 
        n.classList.contains('highlight-content') || 
        n.getAttribute('aria-selected') === 'true' ||
        n.querySelector('.selected, .highlight-content, [aria-selected="true"]') !== null
      );
      if (activeIdx !== -1) return activeIdx;

      // 2. Match by current viewer unit title
      const currentTitleEl = document.querySelector('.content-title, .collection-title, h1, .header-title');
      const currentTitle = (currentTitleEl ? currentTitleEl.innerText : '').replace(/[\n\r]+/g, ' ').trim().toLowerCase();
      if (currentTitle) {
        activeIdx = allNodes.findIndex(n => {
          if (n.getAttribute('level') === '0') return false;
          const title = (n.querySelector('.content-title')?.innerText || n.innerText || '').replace(/[\n\r]+/g, ' ').trim().toLowerCase();
          return title && (title === currentTitle || title.includes(currentTitle) || currentTitle.includes(title));
        });
        if (activeIdx !== -1) return activeIdx;
      }

      // 3. Match by URL lex_auth ID
      const urlMatches = window.location.href.match(/lex_auth_[0-9a-zA-Z_-]+/g) || [];
      for (const lexId of urlMatches) {
        activeIdx = allNodes.findIndex(n => {
          const html = n.outerHTML || '';
          return html.includes(lexId);
        });
        if (activeIdx !== -1) return activeIdx;
      }

      return -1;
    },

    /**
     * Advances STRICTLY FORWARD to the next slide or module in the TOC tree.
     * Never jumps backward to earlier modules, and NEVER skips past the next module.
     */
    async advanceForwardViaToc() {
      if (!AutomatorCore.isRunning) return false;
      await this.ensureContentsTabActive();
      if (!AutomatorCore.isRunning) return false;

      let allNodes = Array.from(document.querySelectorAll('mat-tree-node'));
      if (allNodes.length === 0) return false;

      let currentIdx = this.getCurrentTocNodeIndex();
      if (currentIdx === -1) {
        // Dynamic wait for TOC to highlight active slide
        const startWait = Date.now();
        while (Date.now() - startWait < 1500) {
          if (!AutomatorCore.isRunning) return false;
          await DomUtils.sleep(100);
          currentIdx = this.getCurrentTocNodeIndex();
          if (currentIdx !== -1) break;
        }
      }

      if (currentIdx === -1) {
        AutomatorCore.notify('[Notice] Locating current position in TOC...', 'warn');
        return false;
      }

      // Re-query nodes in case DOM updated
      allNodes = Array.from(document.querySelectorAll('mat-tree-node'));

      // Scan STRICTLY FORWARD from currentIdx + 1
      for (let i = currentIdx + 1; i < allNodes.length; i++) {
        if (!AutomatorCore.isRunning) return false;
        const node = allNodes[i];
        
        const isFolder = node.getAttribute('level') === '0' || 
                         node.querySelector('.toc-expand-icon') !== null || 
                         node.hasAttribute('aria-expanded');

        if (isFolder) {
          // This is the NEXT module folder ahead of our current slide!
          const folderTitle = (node.querySelector('.content-title')?.innerText || node.innerText || 'Module').replace(/[\n\r]+/g, ' ').trim();
          AutomatorCore.notify(`Opening next module: "${folderTitle}"...`, 'info');

          // 1. Expand folder if collapsed
          await this.expandFolder(node);

          // 2. Re-query all nodes to locate its child slides
          const refreshedNodes = Array.from(document.querySelectorAll('mat-tree-node'));
          const folderPos = refreshedNodes.indexOf(node);
          const startSearch = folderPos !== -1 ? folderPos + 1 : i + 1;

          // 3. Find and click the first child slide in this module
          for (let j = startSearch; j < refreshedNodes.length; j++) {
            const childNode = refreshedNodes[j];
            const childIsFolder = childNode.getAttribute('level') === '0' || 
                                  childNode.querySelector('.toc-expand-icon') !== null;
            if (childIsFolder) {
              // Reached next folder without a slide in this one
              break;
            }

            const slideTitle = (childNode.querySelector('.content-title')?.innerText || childNode.innerText || 'Slide').replace(/[\n\r]+/g, ' ').trim();
            AutomatorCore.notify(`Entering first slide in "${folderTitle}": "${slideTitle}"...`, 'info');
            this.clickTreeNode(childNode);
            return true;
          }

          // If child slide not immediately found, click folder directly to navigate
          this.clickTreeNode(node);
          return true;
        }

        // It is a subsequent slide in the current module!
        const slideTitle = (node.querySelector('.content-title')?.innerText || node.innerText || `Slide ${i}`).replace(/[\n\r]+/g, ' ').trim();
        AutomatorCore.notify(`Advancing to next slide: "${slideTitle}"...`, 'info');
        this.clickTreeNode(node);
        return true;
      }

      AutomatorCore.notify('Reached the end of all modules in TOC.', 'info');
      return false;
    },

    /**
     * Advance to the next module in the TOC when at the end of a module (or on a code slide)
     */
    async advanceToNextModule() {
      return await this.advanceForwardViaToc();
    },

    /**
     * Click Next Content button or advance via TOC sidebar / next module
     */
    async advanceToNextUnit() {
      if (!AutomatorCore.isRunning) return false;
      // If any lingering dialog exists, confirm it
      await this.confirmAnyOpenDialog();
      if (!AutomatorCore.isRunning) return false;

      // 1. Try primary Next Content navigation button IF enabled
      const nextSelectors = [
        'button[aria-label="next content"]:not([disabled])',
        'button.navigation-btn-frwd:not([disabled])',
        '.navigation-btn-frwd:not([disabled])',
        '[mattooltip="Next Content"]:not([disabled])',
        'button[aria-label*="next" i]:not([disabled])'
      ];

      for (const sel of nextSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && !btn.classList.contains('mat-button-disabled') && (btn.offsetWidth > 0 || btn.getClientRects().length > 0)) {
            AutomatorCore.notify('Advancing via "Next Content" button...', 'info');
            await AutomatorCore.runInMainWorld('NEXT_CONTENT');
            try { btn.click(); } catch (e) {}
            return true;
          }
        } catch (e) {}
      }

      // 2. Next Content is disabled (at end of module or on code slide) -> Advance strictly forward via TOC!
      AutomatorCore.notify('Next button disabled. Advancing forward via TOC...', 'info');
      return await this.advanceForwardViaToc();
    },

    async advanceViaToc() {
      return await this.advanceForwardViaToc();
    },

    async onStop(reason) {
      console.log('[Springboard Adapter] Stopped:', reason);
      try {
        await chrome.storage.local.remove(['springboardRunning']);
      } catch (e) {}
    }
  };

  if (window.PlatformRegistry) {
    window.PlatformRegistry.register(SpringboardAdapter);
  }
})();
