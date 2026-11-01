/**
 * Platform Adapter: Infosys Springboard (Wingspan / Lex LMS)
 * Supports:
 * - https://infyspringboard.onwingspan.com
 * - Course overview & Table of Contents navigation (/app/toc/...)
 * - Content Viewer automation (/app/viewer/...)
 * - Video.js & HTML5 video playback completion
 * - Hands-on coding exercises (Run, Verify, Submit, remote sandbox wait)
 * - Article reading & Assessment quizzes
 * - "Mark as Complete" with Angular Material Dialog confirmation
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
             document.querySelector('ws-viewer-toc') !== null ||
             document.querySelector('#focus_submit_handson') !== null;
    },

    async init() {
      console.log('[Springboard Adapter] Initialized on Wingspan platform:', window.location.pathname);
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

      const buttons = Array.from(document.querySelectorAll('button, a'));
      const actionBtn = buttons.find(b => {
        if (b.disabled) return false;
        const text = (b.innerText || b.textContent || '').trim().toLowerCase();
        return text === 'start' || text === 'resume' || text === 'start learning' || text === 'continue';
      });

      if (actionBtn) {
        AutomatorCore.notify(`Clicking "${actionBtn.innerText.trim()}" to enter course player...`, 'info');
        actionBtn.click();
        await DomUtils.sleep(3000);
      } else {
        const firstUnit = document.querySelector('mat-tree-node, .toc-unit, .mat-list-item, .resource-item');
        if (firstUnit) {
          firstUnit.click();
          await DomUtils.sleep(3000);
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
          await DomUtils.sleep(600);
        }
      } catch (e) {}
    },

    /**
     * Find and jump directly to the next incomplete unit in the TOC tree
     * Skips already-completed units (done_all) and hands-on coding labs
     */
    async navigateToNextIncompleteUnit() {
      await this.ensureContentsTabActive();

      const treeNodes = Array.from(document.querySelectorAll('mat-tree-node'));
      if (treeNodes.length === 0) {
        return await this.advanceToNextUnit();
      }

      // 1. First, search forward from currently active unit
      const activeIdx = treeNodes.findIndex(n => 
        n.classList.contains('selected') || 
        n.classList.contains('highlight-content') || 
        n.getAttribute('aria-selected') === 'true'
      );

      const startIndex = activeIdx >= 0 ? activeIdx + 1 : 0;

      // Scan all nodes (forward first, then wrap around from 0 if needed)
      const scanOrder = [];
      for (let i = startIndex; i < treeNodes.length; i++) scanOrder.push(i);
      for (let i = 0; i < startIndex; i++) scanOrder.push(i);

      for (const idx of scanOrder) {
        const node = treeNodes[idx];
        const isCompleted = node.querySelector('.completed-color') !== null || 
                            node.innerHTML.includes('done_all') || 
                            node.innerHTML.includes('completed-color');
        const isFolder = node.getAttribute('level') === '0' || 
                         node.querySelector('.toc-expand-icon') !== null || 
                         node.innerHTML.includes('>folder</mat-icon>');
        const isHandsOn = node.innerHTML.includes('>code</mat-icon>');

        // Target: Incomplete, non-folder, non-hands-on unit
        if (!isFolder && !isCompleted && !isHandsOn) {
          const title = node.querySelector('.content-title')?.innerText?.trim() || `Unit ${idx}`;
          AutomatorCore.notify(`🎯 Jumping directly to incomplete unit: "${title}"...`, 'info');
          AutomatorCore.updateHUD(`Jumping: ${title}`, 50);

          const clickable = node.querySelector('.content-title, .expand-button') || node;
          clickable.click();
          await DomUtils.sleep(2500);
          return true;
        }
      }

      return false; // All eligible units completed!
    },

    /**
     * Master Viewer Completer Loop
     * Focuses ONLY on incomplete units, automatically skipping completed & broken hands-on slides
     */
    async runCourseCompleter() {
      AutomatorCore.notify('Infosys Springboard Smart Completer running...', 'info');
      AutomatorCore.showHUD('Infosys Springboard: Completing units...');

      // Always ensure sidebar is on Contents tab
      await this.ensureContentsTabActive();

      const maxSteps = 150;
      let step = 0;

      while (AutomatorCore.isRunning && step < maxSteps) {
        step++;

        await this.ensureContentsTabActive();

        // 1. Identify current unit title
        const unitTitleEl = document.querySelector('.content-title, .collection-title, h1, .header-title');
        const unitTitle = unitTitleEl ? unitTitleEl.innerText.replace(/[\n\r]+/g, ' ').trim() : `Unit ${step}`;
        AutomatorCore.notify(`[Step ${step}] Current slide: "${unitTitle}"`, 'info');

        // 2. Check if current slide is hands-on OR already completed
        const isHandsOn = window.location.href.includes('/viewer/hands-on/') ||
                          document.querySelector('ws-viewer-plugin-hands-on, #focus_execute_handson, #focus_submit_handson');

        const activeNode = document.querySelector('mat-tree-node.selected, mat-tree-node.highlight-content, mat-tree-node[aria-selected="true"]');
        const isAlreadyComplete = activeNode && (
          activeNode.querySelector('.completed-color') !== null || 
          activeNode.innerHTML.includes('done_all') || 
          activeNode.innerHTML.includes('completed-color')
        );

        if (isHandsOn || isAlreadyComplete) {
          if (isHandsOn) {
            AutomatorCore.notify(`⏩ Hands-on lab "${unitTitle}" skipped (remote sandbox broken).`, 'info');
          } else {
            AutomatorCore.notify(`✅ Unit "${unitTitle}" is ALREADY completed! Jumping to next incomplete...`, 'info');
          }

          const jumped = await this.navigateToNextIncompleteUnit();
          if (!jumped) {
            AutomatorCore.notify('🎉 All playable units completed!', 'info');
            AutomatorCore.updateHUD('🎉 Course Completed!', 100);
            AutomatorCore.stop('🎉 Course Completed! All incomplete units finished.');
            break;
          }
          continue;
        }

        // 3. Current unit is INCOMPLETE: Complete it!
        AutomatorCore.updateHUD(`Completing: ${unitTitle}`, 60);

        // A. Start video playback if present so Mark as Complete unlocks immediately
        await this.handleVideoIfPresent();

        // B. Handle Assessment / Quiz options if present
        await this.handleAssessmentIfPresent();

        // C. Instantly trigger & confirm "Mark as Complete" dialog
        await this.markCurrentUnitComplete();

        // D. Jump directly to the next incomplete unit in TOC!
        const advanced = await this.navigateToNextIncompleteUnit();
        if (!advanced) {
          AutomatorCore.notify('🎉 Course completed! All eligible units marked complete.', 'info');
          AutomatorCore.updateHUD('🎉 Course Completed!', 100);
          AutomatorCore.stop('🎉 Course Completed!');
          break;
        }
      }
    },

    /**
     * Handle Hands-on Coding Lab exercises:
     * When remote sandbox hangs/fails on Infosys backend, skip immediately so the course keeps progressing!
     */
    async handleHandsOnIfPresent() {
      const isHandsOn = window.location.href.includes('/viewer/hands-on/') ||
                        document.querySelector('ws-viewer-plugin-hands-on, #focus_execute_handson, #focus_submit_handson');

      if (isHandsOn) {
        AutomatorCore.notify('⏩ Hands-on coding lab detected — skipping to avoid sandbox hang...', 'info');
        AutomatorCore.updateHUD('⏩ Skipping Hands-on Lab...', 50);
        await DomUtils.sleep(600);
        return true;
      }

      return false;
    },

    /**
     * Waits for remote code sandbox evaluation to complete
     */
    async waitForHandsOnSubmission(maxWaitMs = 30000) {
      const startTime = Date.now();
      // Wait at least 2.5s for submission spinner to mount
      await DomUtils.sleep(2500);

      while (Date.now() - startTime < maxWaitMs) {
        const bodyText = (document.body.innerText || '').toLowerCase();
        const isSubmitting = bodyText.includes('your code is being submitted') || 
                             bodyText.includes('code is being submitted');
        const spinner = document.querySelector('ws-viewer-plugin-hands-on mat-progress-spinner, mat-spinner');

        if (!isSubmitting && !spinner) {
          return true;
        }
        await DomUtils.sleep(1000);
      }
      return true;
    },

    /**
     * Start video playback immediately so "Mark as Complete" unlocks without waiting for the full video
     */
    async handleVideoIfPresent() {
      const videos = Array.from(document.querySelectorAll('video'));
      if (videos.length === 0) return;

      AutomatorCore.notify(`Found ${videos.length} video(s). Starting playback to unlock Mark as Complete...`, 'info');

      for (const vid of videos) {
        try {
          vid.muted = true;
          if (vid.paused) {
            vid.play().catch(() => {});
          }
          vid.dispatchEvent(new Event('play'));
          vid.dispatchEvent(new Event('playing'));
        } catch (e) {}
      }

      // Also trigger Video.js instance in MAIN world
      await AutomatorCore.runInMainWorld('VIDEO_ENDED');
      await DomUtils.sleep(600);
    },

    /**
     * Answer assessment / quiz questions if present
     */
    async handleAssessmentIfPresent() {
      const quizOptions = document.querySelectorAll('mat-radio-button, mat-checkbox, input[type="radio"], input[type="checkbox"]');
      if (quizOptions.length === 0) return;

      AutomatorCore.notify('Assessment options detected. Selecting answers...', 'info');

      quizOptions.forEach(opt => {
        try {
          if (!opt.classList.contains('mat-radio-checked') && !opt.classList.contains('mat-checkbox-checked')) {
            opt.click();
          }
        } catch (e) {}
      });

      await DomUtils.sleep(600);

      const buttons = Array.from(document.querySelectorAll('button'));
      const submitBtn = buttons.find(b => {
        if (b.disabled) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'submit' || txt === 'check answer' || txt === 'submit assessment';
      });

      if (submitBtn && !submitBtn.disabled) {
        try { submitBtn.click(); } catch (e) {}
        await DomUtils.sleep(1500);
      }
    },

    /**
     * Click Wingspan's "Mark as Complete" button AND confirm the popup modal dialog
     * Uses client-rects check instead of offsetParent to correctly support position: fixed CDK overlays!
     */
    async markCurrentUnitComplete() {
      // 1. Check if a confirmation dialog is already open on screen
      let confirmBtn = await this.waitForConfirmDialog(1000);
      if (confirmBtn) {
        AutomatorCore.notify('Confirming existing "Mark as complete" dialog...', 'info');
        await AutomatorCore.runInMainWorld('CONFIRM_MARK_COMPLETE');
        try { confirmBtn.click(); } catch (e) {}
        await DomUtils.sleep(2000);
        return true;
      }

      // 2. Click the trigger button in the viewer
      const markSelectors = [
        'button[aria-label="mark as complete"]',
        'button.mark-as-complete-mini',
        '[mattooltip="Mark as Complete"]'
      ];

      let triggerBtn = null;
      for (const sel of markSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && !btn.disabled && (btn.offsetWidth > 0 || btn.getClientRects().length > 0)) {
            triggerBtn = btn;
            break;
          }
        } catch (e) {}
      }

      if (triggerBtn) {
        AutomatorCore.notify('Clicking "Mark as Complete" icon...', 'info');
        await AutomatorCore.runInMainWorld('TRIGGER_MARK_COMPLETE');
        try { triggerBtn.click(); } catch (e) {}

        // 3. Wait up to 3.5 seconds for the Angular Material confirmation dialog to render
        confirmBtn = await this.waitForConfirmDialog(3500);
        if (confirmBtn) {
          AutomatorCore.notify('Confirming "Mark as complete" dialog...', 'info');
          await AutomatorCore.runInMainWorld('CONFIRM_MARK_COMPLETE');
          try { confirmBtn.click(); } catch (e) {}
          await DomUtils.sleep(800);
          return true;
        } else {
          AutomatorCore.notify('Confirmation dialog did not appear (may already be marked complete).', 'info');
        }
      }

      return false;
    },

    /**
     * Polls for Angular Material confirmation dialog buttons
     * Uses getClientRects() instead of offsetParent (which fails on position: fixed CDK dialogs)
     */
    async waitForConfirmDialog(maxWaitMs = 3000) {
      const startTime = Date.now();
      while (Date.now() - startTime < maxWaitMs) {
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
        await DomUtils.sleep(250);
      }
      return null;
    },

    async confirmAnyOpenDialog() {
      const confirmBtn = await this.waitForConfirmDialog(1000);
      if (confirmBtn) {
        await AutomatorCore.runInMainWorld('CONFIRM_MARK_COMPLETE');
        try { confirmBtn.click(); } catch (e) {}
        await DomUtils.sleep(1500);
      }
    },

    /**
     * Click Next Content button or advance via TOC sidebar
     */
    async advanceToNextUnit() {
      // If any lingering dialog exists, confirm it
      await this.confirmAnyOpenDialog();

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
          if (btn && !btn.disabled && (btn.offsetWidth > 0 || btn.getClientRects().length > 0)) {
            AutomatorCore.notify('Advancing via "Next Content" button...', 'info');
            await AutomatorCore.runInMainWorld('NEXT_CONTENT');
            try { btn.click(); } catch (e) {}
            return true;
          }
        } catch (e) {}
      }

      // 2. Fallback: Check TOC in sidebar
      return await this.advanceViaToc();
    },

    async advanceViaToc() {
      try {
        const tabs = Array.from(document.querySelectorAll('div[role="tab"]'));
        const contentsTab = tabs.find(t => (t.innerText || '').toLowerCase().includes('contents'));
        if (contentsTab && !contentsTab.classList.contains('mat-tab-label-active')) {
          contentsTab.click();
          await DomUtils.sleep(1000);
        }

        // 1. Support mat-tree-node (Angular Material TOC Tree)
        const treeNodes = Array.from(document.querySelectorAll('mat-tree-node'));
        if (treeNodes.length > 0) {
          const activeIdx = treeNodes.findIndex(n => 
            n.classList.contains('selected') || 
            n.classList.contains('highlight-content') || 
            n.getAttribute('aria-selected') === 'true'
          );

          if (activeIdx >= 0 && activeIdx + 1 < treeNodes.length) {
            for (let i = activeIdx + 1; i < treeNodes.length; i++) {
              const node = treeNodes[i];
              const clickable = node.querySelector('.expand-button, .content-title') || node;
              const nextTitle = node.querySelector('.content-title')?.innerText?.trim() || `Unit ${i}`;
              AutomatorCore.notify(`Clicking next unit in TOC tree: "${nextTitle}"...`, 'info');
              clickable.click();
              return true;
            }
          }
        }

        // 2. Support flat list TOC
        const units = Array.from(document.querySelectorAll('.toc-scrollable-content .flat-list, ws-viewer-toc .flat-list'));
        const activeUnitIndex = units.findIndex(u => u.classList.contains('highlight-content') || u.classList.contains('active'));

        if (activeUnitIndex >= 0 && activeUnitIndex + 1 < units.length) {
          const nextUnit = units[activeUnitIndex + 1];
          const nextTitle = nextUnit.querySelector('.content-title')?.innerText?.trim() || 'Next Unit';
          AutomatorCore.notify(`Clicking next unit in TOC: "${nextTitle}"...`, 'info');
          nextUnit.click();
          return true;
        }
      } catch (e) {}

      return false;
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
