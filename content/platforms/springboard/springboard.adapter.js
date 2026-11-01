/**
 * Platform Adapter: Infosys Springboard (Wingspan / Lex LMS)
 * Supports:
 * - https://infyspringboard.onwingspan.com
 * - Course overview & Table of Contents navigation (/app/toc/...)
 * - Content Viewer automation (/app/viewer/...)
 * - Video.js, HTML5 video, Article reading, Assessments, and SCORM
 * - One-click "Mark as Complete" & "Next Content" progression
 */
(function () {
  const SpringboardAdapter = {
    id: 'springboard',
    name: 'Infosys Springboard',
    description: 'Auto-completes courses, modules, and tests on Infosys Springboard (Wingspan/Lex).',

    matches(url = window.location.href) {
      return url.includes('onwingspan.com') || 
             url.includes('infyspringboard') ||
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
             document.querySelector('ws-viewer-toc') !== null;
    },

    async init() {
      console.log('[Springboard Adapter] Initialized on Wingspan platform:', window.location.pathname);
    },

    async start() {
      if (AutomatorCore.isRunning) return;
      AutomatorCore.setIsRunning(true);

      AutomatorCore.showHUD('Analyzing Springboard Course...');
      AutomatorCore.notify('Infosys Springboard Automator started.', 'info');

      try {
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

      // Search buttons in the TOC header
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const actionBtn = buttons.find(b => {
        if (!b.offsetParent) return false;
        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        return text === 'start' || text === 'resume' || text === 'start learning' || text === 'continue';
      });

      if (actionBtn) {
        AutomatorCore.notify(`Clicking "${actionBtn.innerText.trim()}" to enter course player...`, 'info');
        DomUtils.simulateClick(actionBtn);
        await DomUtils.sleep(3000);
      } else {
        // Fallback: click first unit in TOC
        const firstUnit = document.querySelector('mat-tree-node, .toc-unit, .mat-list-item, .resource-item');
        if (firstUnit) {
          DomUtils.simulateClick(firstUnit);
          await DomUtils.sleep(3000);
        }
      }
    },

    /**
     * Master Viewer Completer Loop
     * Progresses sequentially through units: Video -> Assessment -> Mark Complete -> Next
     */
    async runCourseCompleter() {
      AutomatorCore.notify('Infosys Springboard Master Completer running...', 'info');
      AutomatorCore.showHUD('Infosys Springboard: Completing units...');

      const maxSteps = 150;
      let step = 0;

      while (AutomatorCore.isRunning && step < maxSteps) {
        step++;

        // 1. Identify current unit title
        const unitTitleEl = document.querySelector('.content-title, .collection-title, h1, .header-title');
        const unitTitle = unitTitleEl ? unitTitleEl.innerText.replace(/[\n\r]+/g, ' ').trim() : `Unit ${step}`;
        AutomatorCore.notify(`[Step ${step}] Completing: "${unitTitle}"`, 'info');
        AutomatorCore.updateHUD(`Completing: ${unitTitle}`, 50);

        // 2. Handle Video if present
        await this.handleVideoIfPresent();

        // 3. Handle Assessment / Quiz options if present
        await this.handleAssessmentIfPresent();

        // 4. Click "Mark as Complete" button
        await this.markCurrentUnitComplete();

        // 5. Advance to Next Unit
        const advanced = await this.advanceToNextUnit();
        if (!advanced) {
          AutomatorCore.notify('🎉 Course completed or no more units available!', 'info');
          AutomatorCore.updateHUD('🎉 Course Completed!', 100);
          AutomatorCore.stop('🎉 Course Completed!');
          break;
        }

        // Wait for next unit to render
        await DomUtils.sleep(3000);
      }
    },

    /**
     * Fast-forward and complete Video.js or HTML5 videos
     */
    async handleVideoIfPresent() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return;

      AutomatorCore.notify(`Found ${videos.length} video(s). Completing playback...`, 'info');

      for (const vid of videos) {
        try {
          vid.muted = true;
          if (vid.duration && !vid.ended) {
            vid.currentTime = Math.max(0, vid.duration - 0.2);
          }
          vid.dispatchEvent(new Event('ended'));
          vid.dispatchEvent(new Event('timeupdate'));
        } catch (e) {}
      }

      await DomUtils.sleep(1500);

      // Video.js Done button
      const doneBtn = document.querySelector('button.vjs-done-button');
      if (doneBtn && !doneBtn.disabled) {
        DomUtils.simulateClick(doneBtn);
        await DomUtils.sleep(1000);
      }
    },

    /**
     * Answer assessment / quiz questions if present
     */
    async handleAssessmentIfPresent() {
      const quizOptions = document.querySelectorAll('mat-radio-button, mat-checkbox, input[type="radio"], input[type="checkbox"]');
      if (quizOptions.length === 0) return;

      AutomatorCore.notify('Assessment options detected. Selecting answers...', 'info');

      // Select option
      quizOptions.forEach(opt => {
        try {
          if (!opt.classList.contains('mat-radio-checked') && !opt.classList.contains('mat-checkbox-checked')) {
            DomUtils.simulateClick(opt);
          }
        } catch (e) {}
      });

      await DomUtils.sleep(600);

      // Look for Submit button
      const buttons = Array.from(document.querySelectorAll('button'));
      const submitBtn = buttons.find(b => {
        if (!b.offsetParent) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'submit' || txt === 'check answer' || txt === 'submit assessment';
      });

      if (submitBtn && !submitBtn.disabled) {
        DomUtils.simulateClick(submitBtn);
        await DomUtils.sleep(1200);
      }
    },

    /**
     * Click Wingspan's "Mark as Complete" button
     */
    async markCurrentUnitComplete() {
      const selectors = [
        'button[aria-label="mark as complete"]',
        'button.mark-as-complete-mini',
        '[mattooltip="Mark as Complete"]',
        'button:has-text("Mark as Complete")'
      ];

      for (const sel of selectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null && !btn.disabled) {
            AutomatorCore.notify('Clicking "Mark as Complete"...', 'info');
            DomUtils.simulateClick(btn);
            await DomUtils.sleep(1500);
            return true;
          }
        } catch (e) {}
      }

      // Check button by text/aria
      const allButtons = Array.from(document.querySelectorAll('button, a'));
      const found = allButtons.find(b => {
        if (!b.offsetParent) return false;
        const txt = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return txt.includes('mark as complete') || txt === 'done_all';
      });

      if (found && !found.disabled) {
        AutomatorCore.notify('Clicking "Mark as Complete"...', 'info');
        DomUtils.simulateClick(found);
        await DomUtils.sleep(1500);
        return true;
      }

      return false;
    },

    /**
     * Click Next Content button or advance via TOC sidebar
     */
    async advanceToNextUnit() {
      // 1. Try primary Next Content navigation button
      const nextSelectors = [
        'button[aria-label="next content"]',
        'button.navigation-btn-frwd',
        '.navigation-btn-frwd',
        '[mattooltip="Next Content"]',
        'button[aria-label*="next" i]'
      ];

      for (const sel of nextSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null && !btn.disabled) {
            AutomatorCore.notify('Advancing via "Next Content" button...', 'info');
            DomUtils.simulateClick(btn);
            return true;
          }
        } catch (e) {}
      }

      // 2. Fallback: Check TOC in sidebar
      return await this.advanceViaToc();
    },

    async advanceViaToc() {
      try {
        // Open Contents tab if not already open
        const tabs = Array.from(document.querySelectorAll('div[role="tab"]'));
        const contentsTab = tabs.find(t => (t.innerText || '').toLowerCase().includes('contents'));
        if (contentsTab && !contentsTab.classList.contains('mat-tab-label-active')) {
          DomUtils.simulateClick(contentsTab);
          await DomUtils.sleep(1000);
        }

        // Find next unit in TOC
        const units = Array.from(document.querySelectorAll('.toc-scrollable-content .flat-list, ws-viewer-toc .flat-list'));
        const activeUnitIndex = units.findIndex(u => u.classList.contains('highlight-content') || u.classList.contains('active'));

        if (activeUnitIndex >= 0 && activeUnitIndex + 1 < units.length) {
          const nextUnit = units[activeUnitIndex + 1];
          const nextTitle = nextUnit.querySelector('.content-title')?.innerText?.trim() || 'Next Unit';
          AutomatorCore.notify(`Clicking next unit in TOC: "${nextTitle}"...`, 'info');
          DomUtils.simulateClick(nextUnit);
          return true;
        }
      } catch (e) {}

      return false;
    },

    onStop(reason) {
      console.log('[Springboard Adapter] Stopped:', reason);
    }
  };

  if (window.PlatformRegistry) {
    window.PlatformRegistry.register(SpringboardAdapter);
  }
})();
