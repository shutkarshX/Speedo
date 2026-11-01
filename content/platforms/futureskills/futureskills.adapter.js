/**
 * Platform Adapter: FutureSkills Prime (iHUB / TCS iEvolve LMS)
 * Encapsulated provider for FutureSkills Prime courses and pathways:
 * - Multi-Module Pathway Auto-Runner (auto-launches, auto-returns, loops 1..N)
 * - Single-Course Master Completer with Strict Incomplete Recovery (Previous -> Mark -> Next)
 * - Anti-Hang spinner removal & main-world execution bridge
 */
(function () {
  const FutureSkillsAdapter = {
    id: 'futureskills',
    name: 'FutureSkills Prime',
    description: 'Auto-completes courses, pathways, and quizzes on FutureSkills Prime (iHUB/iEvolve).',

    /**
     * Platform detection rule
     */
    matches(url = window.location.href, doc = document) {
      return url.includes('futureskillsprime.in') || 
             doc.querySelector('img[src*="futureskills"]') !== null ||
             doc.querySelector('.allActiveProd') !== null ||
             doc.querySelector('.innerDefault') !== null;
    },

    isPathwayPage() {
      return window.location.pathname.includes('/Dashboard/Products_detail/') || 
             document.querySelectorAll('.allActiveProd').length > 0;
    },

    isCoursePlayerPage() {
      return window.location.pathname.includes('/LX/content_players/') || 
             document.querySelectorAll('.innerDefault').length > 0;
    },

    /**
     * Initialization & Auto-Resume Lifecycle
     */
    async init() {
      try {
        const data = await chrome.storage.local.get(['pathwayRunner']);

        // Check if on Course Player page
        if (this.isCoursePlayerPage()) {
          if (data?.pathwayRunner?.active) {
            console.log('[FutureSkills Adapter] Pathway mode detected in Course Player!');
            AutomatorCore.showHUD(`🚀 Pathway Mode: Auto-starting "${data.pathwayRunner.currentModuleTitle || 'Course'}" in 2s...`);
            setTimeout(() => {
              if (!AutomatorCore.isRunning) this.start();
            }, 2000);
          }
        } 
        // Check if on Pathway Dashboard page
        else if (this.isPathwayPage()) {
          if (data?.pathwayRunner?.active) {
            console.log('[FutureSkills Adapter] Pathway runner active on Dashboard! Advancing to next module...');
            AutomatorCore.showHUD('🚀 Pathway Automator: Checking next module in 2.5s...');
            setTimeout(() => {
              if (!AutomatorCore.isRunning) this.start();
            }, 2500);
          } else {
            // Inject floating quick-launch banner on Pathway page
            setTimeout(() => {
              this.injectPathwayBanner();
            }, 2000);
          }
        }
      } catch (e) {
        console.warn('[FutureSkills Adapter] Init error:', e);
      }
    },

    /**
     * Main Start Entry Point
     */
    async start() {
      if (AutomatorCore.isRunning) return;
      AutomatorCore.setIsRunning(true);

      try {
        if (this.isPathwayPage()) {
          AutomatorCore.showHUD('Initializing Pathway Automator...');
          AutomatorCore.notify('Pathway Dashboard detected. Starting Pathway Orchestrator...', 'info');
          await this.runPathwayOrchestrator();
        } else if (this.isCoursePlayerPage()) {
          AutomatorCore.showHUD('Initializing Course Automator...');
          AutomatorCore.notify('Course Player detected. Starting Course Completer...', 'info');
          await this.runCourseCompleter();
        } else {
          AutomatorCore.notify('Unknown FutureSkills page format.', 'warn');
        }
      } catch (error) {
        AutomatorCore.notify(`Automation error: ${error.message}`, 'error');
        console.error('[FutureSkills Adapter] Error:', error);
      } finally {
        AutomatorCore.setIsRunning(false);
      }
    },

    onStop(reason) {
      console.log('[FutureSkills Adapter] Stopped:', reason);
    },

    // -----------------------------------------------------------
    // Pathway Orchestrator (Multi-Module Progression)
    // -----------------------------------------------------------
    async runPathwayOrchestrator() {
      AutomatorCore.notify('Scanning Pathway modules...', 'info');
      AutomatorCore.updateHUD('Scanning Pathway modules...', 0);

      // 1. Wait for modules to render (AngularJS dynamic load)
      const rendered = await this.waitForPathwayModules(10000);
      if (!rendered) {
        AutomatorCore.notify('No modules (.allActiveProd) found after waiting.', 'error');
        AutomatorCore.updateHUD('Error: Modules failed to load', 0);
        AutomatorCore.stop('No modules found.');
        return;
      }

      const cards = Array.from(document.querySelectorAll('.allActiveProd'));
      AutomatorCore.notify(`Found ${cards.length} total modules in this pathway.`, 'info');

      // Read already completed modules from storage memory
      const runnerData = await chrome.storage.local.get(['pathwayRunner']);
      const knownCompleted = runnerData?.pathwayRunner?.completedModules || [];

      // 2. Parse and evaluate completion status for each module
      const modulesList = cards.map((card, index) => {
        const titleEl = card.querySelector('h3');
        const title = titleEl?.getAttribute('data-original-title') || 
                      titleEl?.innerText?.trim() || 
                      `Module ${index + 1}`;
        const id = card.id ? card.id.replace('pro_', '') : '';

        const complSpan = card.querySelector('.compltxt');
        const hasComplText = complSpan && 
                             window.getComputedStyle(complSpan).display !== 'none' && 
                             complSpan.innerText.includes('Completed');

        const progressBar = card.querySelector('.progress-bar');
        const isProgress100 = progressBar && progressBar.style.width === '100%';

        const launchBtn = card.querySelector('.launchBtn') || 
                          card.querySelector('a[onclick*="getsubdata"]');
        const btnText = launchBtn ? launchBtn.innerText.trim() : '';

        const isCompleted = hasComplText || 
                            (isProgress100 && btnText !== 'Launch') || 
                            knownCompleted.includes(id);

        return {
          index,
          id,
          title,
          card,
          launchBtn,
          btnText,
          isCompleted
        };
      });

      const completedCount = modulesList.filter(m => m.isCompleted).length;
      const incompleteList = modulesList.filter(m => !m.isCompleted);
      const total = modulesList.length;

      AutomatorCore.notify(`Pathway Status: ${completedCount}/${total} modules completed (${incompleteList.length} remaining).`, 'info');
      const overallPercent = Math.round((completedCount / total) * 100);
      AutomatorCore.updateHUD(`Pathway: ${completedCount}/${total} Completed (${overallPercent}%)`, overallPercent);

      // 3. Check if entire pathway is 100% complete
      if (incompleteList.length === 0) {
        AutomatorCore.notify('🏆 ALL PATHWAY MODULES 100% COMPLETED!', 'info');
        AutomatorCore.updateHUD('🏆 ALL 12 PATHWAY MODULES 100% COMPLETED!', 100);
        await chrome.storage.local.remove(['pathwayRunner']);
        AutomatorCore.stop('🏆 Entire Pathway 100% Complete!');
        return;
      }

      // 4. Select next incomplete module
      const nextMod = incompleteList[0];
      AutomatorCore.notify(`[Next Module] Launching "${nextMod.title}" (ID: ${nextMod.id})...`, 'info');
      AutomatorCore.updateHUD(`Launching: ${nextMod.title}`, overallPercent);

      // 5. Store pathwayRunner state in storage
      await chrome.storage.local.set({
        pathwayRunner: {
          active: true,
          pathwayUrl: window.location.href,
          currentModuleId: nextMod.id,
          currentModuleTitle: nextMod.title,
          totalModules: total,
          completedCount: completedCount,
          completedModules: knownCompleted,
          autoClosePlayer: true
        }
      });

      await DomUtils.sleep(1200);

      // 6. Launch module directly in MAIN world AND via button click
      if (nextMod.id) {
        await AutomatorCore.runInMainWorld(`GET_SUB_DATA:${nextMod.id}`);
      }
      if (nextMod.launchBtn) {
        DomUtils.simulateClick(nextMod.launchBtn);
      }

      AutomatorCore.notify(`Launched "${nextMod.title}". Waiting for course player tab to complete...`, 'info');
      AutomatorCore.updateHUD(`In Progress: ${nextMod.title}`, overallPercent);
    },

    async waitForPathwayModules(maxWaitMs = 10000) {
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        const cards = document.querySelectorAll('.allActiveProd');
        if (cards.length > 0) return true;
        await DomUtils.sleep(500);
      }
      return false;
    },

    injectPathwayBanner() {
      const existingBanner = document.getElementById('ca-pathway-banner');
      if (existingBanner) return;

      const cards = document.querySelectorAll('.allActiveProd');
      if (cards.length === 0) return;

      let completed = 0;
      cards.forEach(card => {
        const complSpan = card.querySelector('.compltxt');
        const isCompl = complSpan && window.getComputedStyle(complSpan).display !== 'none' && complSpan.innerText.includes('Completed');
        const progressBar = card.querySelector('.progress-bar');
        const isProgress100 = progressBar && progressBar.style.width === '100%';
        const launchBtn = card.querySelector('.launchBtn');
        const btnText = launchBtn ? launchBtn.innerText.trim() : '';
        if (isCompl || (isProgress100 && btnText !== 'Launch')) completed++;
      });

      const banner = document.createElement('div');
      banner.id = 'ca-pathway-banner';
      banner.innerHTML = `
        <div class="ca-banner-info">
          <div class="ca-banner-title">⚡ Pathway Automator</div>
          <div class="ca-banner-sub">${completed}/${cards.length} Modules Completed</div>
        </div>
        <button id="ca-banner-launch-btn" class="ca-banner-btn">
          ${completed === cards.length ? '✅ Pathway 100% Done' : '🚀 Auto-Complete Pathway'}
        </button>
      `;
      document.body.appendChild(banner);

      const btn = document.getElementById('ca-banner-launch-btn');
      if (btn && completed < cards.length) {
        btn.addEventListener('click', () => {
          banner.remove();
          this.start();
        });
      }
    },

    // -----------------------------------------------------------
    // Course Player Master Completer (Earliest-Targeter + Prerequisite Recovery)
    // -----------------------------------------------------------
    async runCourseCompleter() {
      AutomatorCore.notify('FutureSkills Prime Player connected.', 'info');
      this.dismissWarningPopupsSafely();

      const maxIterations = 80;
      let iterations = 0;

      while (AutomatorCore.isRunning && iterations < maxIterations) {
        iterations++;

        // 1. Query live Table of Contents
        const allUnits = Array.from(document.querySelectorAll('.innerDefault'));
        if (allUnits.length === 0) {
          AutomatorCore.notify('No units found in Table of Contents.', 'warn');
          break;
        }

        const completedUnits = allUnits.filter(u => u.classList.contains('marked'));
        const incompleteUnits = allUnits.filter(u => !u.classList.contains('marked'));
        const totalUnits = allUnits.length;
        const currentPercent = Math.round((completedUnits.length / totalUnits) * 100);

        // 2. Check if 100% complete
        if (incompleteUnits.length === 0) {
          if (this.isPrerequisiteScreenShowing()) {
            AutomatorCore.notify('Prerequisites screen currently showing. Resolving prerequisites before completing...', 'warn');
            const lastUnit = allUnits[allUnits.length - 1];
            await this.handlePrerequisiteRecovery(lastUnit, this.getUnitTitle(lastUnit), allUnits.length - 1, allUnits);
          } else {
            AutomatorCore.notify(`🎉 All ${totalUnits} units 100% verified complete!`, 'info');
            AutomatorCore.updateHUD('🎉 Module 100% Complete!', 100);
            await this.handleModuleCompletion();
            break;
          }
        }

        // 3. Target earliest incomplete unit
        const targetUnit = incompleteUnits[0];
        const unitTitle = this.getUnitTitle(targetUnit);
        const targetIndex = allUnits.indexOf(targetUnit);
        const params = this.extractUnitParams(targetUnit);

        AutomatorCore.updateHUD(`[${completedUnits.length + 1}/${totalUnits}] ${unitTitle}`, currentPercent);
        AutomatorCore.notify(`[${completedUnits.length + 1}/${totalUnits}] Completing: "${unitTitle}"`, 'info');

        // 4. Click target unit to activate on screen
        try {
          targetUnit.click();
        } catch (e) {}

        await DomUtils.sleep(1500);
        await this.waitForSpinnerToClear(2000);
        this.dismissWarningPopupsSafely();

        // 5. Check for warning popup (#markWarningPopup) OR in-slide Prerequisites gate
        const warningPopup = document.getElementById('markWarningPopup');
        const isWarningShowing = warningPopup && 
                                 window.getComputedStyle(warningPopup).display !== 'none' && 
                                 warningPopup.offsetParent !== null;

        if (isWarningShowing || this.isPrerequisiteScreenShowing()) {
          await this.handlePrerequisiteRecovery(targetUnit, unitTitle, targetIndex, allUnits);
        }

        // 6. If STILL on prerequisite screen, do NOT mark complete or advance blindly!
        if (this.isPrerequisiteScreenShowing()) {
          AutomatorCore.notify(`⚠️ "${unitTitle}" is still blocked by prerequisites. Re-attempting recovery on next cycle...`, 'warn');
          await DomUtils.sleep(1500);
          continue;
        }

        // 7. Complete video if video tag present
        if (document.querySelectorAll('video').length > 0) {
          await this.completeVideoUnit();
        }

        // 8. Answer quiz if present
        await this.handleQuizIfPresent();

        // 9. Toggle Mark as Read on current slide
        await this.markCurrentSlideRead();

        // 10. Send backend completion request to LMS server
        if (params) {
          const url = `/LX/contents/content_complete?c_id=${encodeURIComponent(params.c_id)}&content_id=${encodeURIComponent(params.toc_id)}&id=${encodeURIComponent(params.content_id)}&content_activity_completed_count=0&total_content_activity_count=0`;
          try {
            await fetch(url, { method: 'GET', credentials: 'include' });
          } catch (err) {}
        }

        // 11. Final verification: only add marked class if prerequisite screen is NOT showing
        await DomUtils.sleep(800);
        if (!this.isPrerequisiteScreenShowing()) {
          targetUnit.classList.add('marked');
          const tick = targetUnit.querySelector('.greenTickIcon');
          if (tick) tick.style.display = 'block';
        }

        this.dismissWarningPopupsSafely();
        await DomUtils.sleep(1200);
      }
    },

    /**
     * Executes User's Recovery Rule:
     * Previous -> Mark/Complete -> Next -> Verify
     */
    async handlePrerequisiteRecovery(targetUnit, unitTitle, targetIndex, allUnits) {
      AutomatorCore.notify(`⚠️ Prerequisites gate detected on "${unitTitle}". Running: Previous -> Complete -> Next...`, 'warn');
      AutomatorCore.updateHUD(`⚠️ Prerequisites Gate: Recovering previous node...`, 0);
      this.dismissWarningPopupsSafely();

      const prevIndex = Math.max(0, targetIndex - 1);
      const prevUnit = allUnits[prevIndex];
      const prevParams = prevUnit ? this.extractUnitParams(prevUnit) : null;
      const prevTitle = prevUnit ? this.getUnitTitle(prevUnit) : 'Previous Node';

      // Step 1: Click PREVIOUS node
      AutomatorCore.notify(`[Recovery] Clicking Previous Node (< Previous Node / "${prevTitle}")...`, 'info');
      await this.clickPreviousNode(prevUnit);

      // Step 2: Wait for previous slide to render
      await DomUtils.sleep(2000);
      await this.waitForSpinnerToClear(2000);
      this.dismissWarningPopupsSafely();

      // Step 3: Complete previous slide thoroughly
      AutomatorCore.notify(`[Recovery] On "${prevTitle}": marking as read and completing...`, 'info');
      if (document.querySelectorAll('video').length > 0) {
        await this.completeVideoUnit();
      }
      await this.handleQuizIfPresent();
      await this.markCurrentSlideRead();

      // Send backend completion for previous unit
      if (prevParams) {
        const prevUrl = `/LX/contents/content_complete?c_id=${encodeURIComponent(prevParams.c_id)}&content_id=${encodeURIComponent(prevParams.toc_id)}&id=${encodeURIComponent(prevParams.content_id)}&content_activity_completed_count=0&total_content_activity_count=0`;
        try {
          await fetch(prevUrl, { method: 'GET', credentials: 'include' });
          AutomatorCore.notify(`[Recovery] Sent backend content_complete for "${prevTitle}"`, 'info');
        } catch (e) {}
      }
      await DomUtils.sleep(1200);

      // Step 4: Click NEXT node
      AutomatorCore.notify(`[Recovery] Clicking Next Node (Next Node > / "${unitTitle}")...`, 'info');
      await this.clickNextNode(targetUnit);

      // Step 5: Wait for target slide to reload
      await DomUtils.sleep(2500);
      await this.waitForSpinnerToClear(2000);
      this.dismissWarningPopupsSafely();

      // Step 6: If gate is still showing, blast all preceding units with completion requests
      if (this.isPrerequisiteScreenShowing()) {
        AutomatorCore.notify(`⚠️ Prerequisites gate still visible. Sending all preceding prerequisite completions...`, 'warn');
        for (let j = 0; j < targetIndex; j++) {
          const p = this.extractUnitParams(allUnits[j]);
          if (p) {
            const u = `/LX/contents/content_complete?c_id=${encodeURIComponent(p.c_id)}&content_id=${encodeURIComponent(p.toc_id)}&id=${encodeURIComponent(p.content_id)}&content_activity_completed_count=0&total_content_activity_count=0`;
            try { await fetch(u, { method: 'GET', credentials: 'include' }); } catch (e) {}
          }
        }
        await DomUtils.sleep(1200);

        if (targetUnit) {
          try { targetUnit.click(); } catch (e) {}
        }
        await DomUtils.sleep(2000);
        await this.waitForSpinnerToClear(2000);
      }

      if (!this.isPrerequisiteScreenShowing()) {
        AutomatorCore.notify(`✅ Prerequisites gate cleared for "${unitTitle}"! Ready to complete.`, 'info');
      }
    },

    isPrerequisiteScreenShowing() {
      const bodyText = (document.body.innerText || '').toLowerCase();
      const hasPrereqHeading = bodyText.includes('prerequisites');
      const hasPrereqText = bodyText.includes('to access this node') || 
                            bodyText.includes('required to complete') || 
                            bodyText.includes('prerequisite(s)');
      
      const prevBtn = this.getPreviousNodeBtn();
      const hasPrevBtn = prevBtn && prevBtn.offsetParent !== null;

      return (hasPrereqHeading && hasPrereqText) || (hasPrereqText && hasPrevBtn);
    },

    getPreviousNodeBtn() {
      const selectors = [
        '#previous_container',
        '.previous_container',
        '#previous_arrow_left',
        '._prevStep',
        '.prev_node',
        '#prev_node',
        '[data-action="previous"]'
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) return el;
      }

      const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], div, span'));
      return candidates.find(el => {
        if (!el.offsetParent) return false;
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        return (t.includes('previous node') || t === '< previous' || t === 'previous') && el.children.length <= 2;
      }) || null;
    },

    getNextNodeBtn() {
      const selectors = [
        '#next_container',
        '.next_container',
        '#markReadPopupBtn',
        '#arrow_right',
        '._nxtStep',
        '.next_node',
        '#next_node',
        '[data-action="next"]'
      ];
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (el && el.offsetParent !== null) return el;
      }

      const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], div, span'));
      return candidates.find(el => {
        if (!el.offsetParent) return false;
        const t = (el.innerText || el.textContent || '').trim().toLowerCase();
        return (t.includes('next node') || t === 'next >' || t === 'next') && el.children.length <= 2;
      }) || null;
    },

    async clickPreviousNode(fallbackUnitEl = null) {
      const prevBtn = this.getPreviousNodeBtn();
      if (prevBtn) {
        try { DomUtils.simulateClick(prevBtn); } catch (e) {}
      }
      if (fallbackUnitEl) {
        try { fallbackUnitEl.click(); } catch (e) {}
      }
      await AutomatorCore.runInMainWorld('BACK_BUTTON');
    },

    async clickNextNode(fallbackUnitEl = null) {
      const nextBtn = this.getNextNodeBtn();
      if (nextBtn) {
        try { DomUtils.simulateClick(nextBtn); } catch (e) {}
      }
      if (fallbackUnitEl) {
        try { fallbackUnitEl.click(); } catch (e) {}
      }
      await AutomatorCore.runInMainWorld('NEXT_BUTTON');
    },

    async markCurrentSlideRead() {
      const togBtn = document.querySelector('.togBtn');
      if (togBtn && !togBtn.checked && !togBtn.disabled) {
        try { DomUtils.simulateClick(togBtn); } catch (e) {}
        await DomUtils.sleep(300);
      }

      const markReadIcon = document.querySelector('.markReadIcon');
      if (markReadIcon) {
        try { DomUtils.simulateClick(markReadIcon); } catch (e) {}
      }

      await AutomatorCore.runInMainWorld('MARK_READ');
      await DomUtils.sleep(300);
      this.dismissWarningPopupsSafely();
    },

    async handleQuizIfPresent() {
      try {
        const options = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        if (options.length > 0) {
          const grouped = {};
          options.forEach(opt => {
            const name = opt.name || 'default';
            if (!grouped[name]) grouped[name] = [];
            grouped[name].push(opt);
          });

          Object.values(grouped).forEach(opts => {
            const anyChecked = opts.some(o => o.checked);
            if (!anyChecked && opts.length > 0) {
              DomUtils.simulateClick(opts[0]);
            }
          });

          await DomUtils.sleep(250);

          const submitBtn = document.querySelector('button.submit, input[type="submit"], .btn-submit, #submit_btn');
          if (submitBtn && !submitBtn.disabled) {
            DomUtils.simulateClick(submitBtn);
            await DomUtils.sleep(300);
            this.dismissWarningPopupsSafely();
          }
        }
      } catch (e) {}
    },

    async completeVideoUnit() {
      const videos = document.querySelectorAll('video');
      if (videos.length === 0) return;

      videos.forEach((vid) => {
        try {
          vid.muted = true;
          if (vid.duration && !vid.ended) {
            vid.currentTime = Math.max(0, vid.duration - 0.2);
          }
          vid.dispatchEvent(new Event('ended'));
          vid.dispatchEvent(new Event('timeupdate'));
          if (typeof vid.onended === 'function') {
            vid.onended();
          }
        } catch (e) {}
      });

      await DomUtils.sleep(250);
      await AutomatorCore.runInMainWorld('VIDEO_ENDED');
    },

    async waitForSpinnerToClear(maxWaitMs = 2500) {
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
        const mainLoader = document.querySelector('.mainLoader');
        const bannerLoader = document.querySelector('.banner_content.loader_wrapper');
        const isSpinnerVisible = (mainLoader && mainLoader.offsetParent !== null) || 
                                (bannerLoader && bannerLoader.offsetParent !== null);

        if (!isSpinnerVisible) {
          return true;
        }
        await DomUtils.sleep(300);
      }

      document.querySelectorAll('.mainLoader, .loader_wrapper').forEach(el => {
        try { el.remove(); } catch (e) {}
      });

      return true;
    },

    extractUnitParams(unitElement) {
      const onclickAttr = unitElement.getAttribute('onclick') || '';
      const match = onclickAttr.match(/content_url\('([^']+)'/);
      if (!match) return null;

      try {
        const rawUrl = match[1].replace(/&amp;/g, '&');
        const urlObj = new URL(rawUrl, window.location.origin);
        const c_id = urlObj.searchParams.get('c_id');
        const content_id = urlObj.searchParams.get('content_id');
        const toc_id = urlObj.searchParams.get('toc_id');

        if (c_id && content_id && toc_id) {
          return { c_id, content_id, toc_id };
        }
      } catch (e) {}
      return null;
    },

    dismissWarningPopupsSafely() {
      try {
        const warningPopup = document.getElementById('markWarningPopup');
        if (warningPopup) {
          warningPopup.style.display = 'none';
          warningPopup.classList.remove('in');
        }

        const overlay = document.getElementById('overlay');
        if (overlay) overlay.style.display = 'none';

        document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
        document.body.classList.remove('modal-open');
      } catch (e) {}
    },

    getUnitTitle(unitElement) {
      if (!unitElement) return 'Unit';
      const h4 = unitElement.querySelector('h4');
      if (h4) return h4.innerText.replace(/[\n\r]+/g, ' ').trim();
      return unitElement.innerText.slice(0, 35).trim();
    },

    async handleModuleCompletion() {
      const data = await chrome.storage.local.get(['pathwayRunner']);
      const isPathwayActive = data?.pathwayRunner?.active;

      if (isPathwayActive) {
        const modTitle = data.pathwayRunner.currentModuleTitle || 'Module';
        AutomatorCore.updateHUD(`🎉 "${modTitle}" 100% Complete! Returning to Pathway in 2s...`, 100);
        AutomatorCore.notify(`🎉 "${modTitle}" 100% Complete! Closing tab and advancing Pathway...`, 'info');

        chrome.runtime.sendMessage({
          action: 'MODULE_COMPLETED',
          moduleId: data.pathwayRunner.currentModuleId
        });
      } else {
        AutomatorCore.updateHUD('🎉 Course 100% Complete! Refreshing page in 3s...', 100);
        AutomatorCore.notify('🎉 Course 100% Complete! Reloading in 3s to reflect verified 100%...', 'info');
        AutomatorCore.stop('🎉 Course 100% Complete!');

        setTimeout(() => {
          window.location.reload();
        }, 3000);
      }
    }
  };

  // Register FutureSkillsAdapter with the global registry
  if (window.PlatformRegistry) {
    window.PlatformRegistry.register(FutureSkillsAdapter);
  }
})();
