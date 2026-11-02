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

        // B. Answer quiz/assessment if present
        await this.handleAssessmentIfPresent();
        if (!AutomatorCore.isRunning) break;

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
     * Answer assessment / quiz questions dynamically if present
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

      await DomUtils.sleep(200);

      const buttons = Array.from(document.querySelectorAll('button'));
      const submitBtn = buttons.find(b => {
        if (b.disabled) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        return txt === 'submit' || txt === 'check answer' || txt === 'submit assessment';
      });

      if (submitBtn && !submitBtn.disabled) {
        try { submitBtn.click(); } catch (e) {}
        await DomUtils.sleep(300);
      }
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
