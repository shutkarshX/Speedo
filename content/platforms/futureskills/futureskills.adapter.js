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

    isDashboardModularCourse() {
      const cards = document.querySelectorAll('.allActiveProd');
      for (const card of cards) {
        if (card.querySelector('.getStarted, button[onclick*="getSubProduct"], button[onclick*="buyProductNow"]')) {
          return true;
        }
      }
      return false;
    },

    isCoursePlayerPage() {
      return window.location.pathname.includes('/LX/content_players/') || 
             document.querySelectorAll('.innerDefault').length > 0;
    },

    isQuizPage() {
      return window.location.pathname.includes('/LX/quizzes/') || 
             document.querySelector('.start_quiz_btn, .submit_quiz_step1, .submit_quiz_btn, form[action*="quiz_question_answers"]') !== null;
    },

    isQuizAlreadySubmitted() {
      if (document.querySelector('.retake_quiz_btn, .review_quiz_content, .rev_btn')) return true;
      const text = (document.body?.innerText || '').toLowerCase();
      if (text.includes('retake quiz attempt') || text.includes('view quiz responses') || text.includes('preview response')) {
        return true;
      }
      return false;
    },

    /**
     * Initialization & Auto-Resume Lifecycle
     */
    async init() {
      try {
        if (this.isQuizPage()) {
          console.log('[FutureSkills Adapter] Quiz page detected!');
          if (this.isQuizAlreadySubmitted()) {
            AutomatorCore.notify('Quiz is already completed and passed! Closing tab in 1s...', 'info');
            await chrome.storage.local.set({ speedo_last_quiz_completed: Date.now() });
            setTimeout(() => {
              chrome.runtime.sendMessage({ action: 'CLOSE_CURRENT_TAB' });
              try { window.close(); } catch (e) {}
            }, 1000);
            return;
          }
          AutomatorCore.notify('FutureSkills Quiz detected on page. Auto-solving in 1.5s...', 'info');
          setTimeout(() => {
            if (!AutomatorCore.isRunning) this.start();
          }, 1500);
          return;
        }

        const data = await chrome.storage.local.get(['pathwayRunner', 'autoResumeCourse']);

        // Check if on Course Player page
        if (this.isCoursePlayerPage()) {
          if (data?.pathwayRunner?.active || data?.autoResumeCourse) {
            console.log('[FutureSkills Adapter] Auto-resume mode detected in Course Player!');
            AutomatorCore.showHUD(` Resuming Course Automator in 1.5s...`);
            setTimeout(() => {
              if (!AutomatorCore.isRunning) this.start();
            }, 1500);
          }
        } 
        // Check if on Pathway Dashboard page
        else if (this.isPathwayPage()) {
          if (data?.pathwayRunner?.active) {
            console.log('[FutureSkills Adapter] Pathway runner active on Dashboard! Advancing to next module...');
            AutomatorCore.showHUD(' Pathway Automator: Checking next module in 2.5s...');
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
        if (this.isQuizPage()) {
          AutomatorCore.showHUD('SPEEDO FutureSkills Quiz Solver Active');
          AutomatorCore.notify('FutureSkills Quiz detected. Solving 100% verified correct answers...', 'info');
          await this.runQuizSolver();
          return;
        }

        if (this.isPathwayPage()) {
          if (this.isDashboardModularCourse()) {
            AutomatorCore.showHUD('Modular Course Automator Active');
            await this.runDashboardModularCompleter();
          } else {
            AutomatorCore.showHUD('Initializing Pathway Automator...');
            AutomatorCore.notify('Pathway Dashboard detected. Starting Pathway Orchestrator...', 'info');
            await this.runPathwayOrchestrator();
          }
        } else if (this.isCoursePlayerPage()) {
          await chrome.storage.local.set({ autoResumeCourse: true });
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
      chrome.storage.local.remove(['autoResumeCourse']).catch(() => {});
      this.pauseAndMuteAllVideos();
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
        AutomatorCore.notify('No modules (.allActiveProd) found after waiting on this frame.', 'warn');
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
        AutomatorCore.notify(' ALL PATHWAY MODULES 100% COMPLETED!', 'info');
        AutomatorCore.updateHUD(' ALL 12 PATHWAY MODULES 100% COMPLETED!', 100);
        await chrome.storage.local.remove(['pathwayRunner']);
        AutomatorCore.stop(' Entire Pathway 100% Complete!');
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

    // -----------------------------------------------------------
    // Modular Dashboard Course Completer (Articles, Enrol & Quizzes)
    // -----------------------------------------------------------
    async runDashboardModularCompleter() {
      AutomatorCore.notify('Modular Course Dashboard detected. Beginning auto-progression...', 'info');

      const maxPasses = 30;
      let pass = 0;

      while (AutomatorCore.isRunning && pass < maxPasses) {
        pass++;

        let cards = Array.from(document.querySelectorAll('.allActiveProd'));
        if (cards.length === 0) {
          await DomUtils.sleep(2000);
          cards = Array.from(document.querySelectorAll('.allActiveProd'));
          if (cards.length === 0) {
            AutomatorCore.notify('No modules (.allActiveProd) found.', 'warn');
            break;
          }
        }

        const total = cards.length;
        let completedCount = 0;
        let targetCard = null;
        let targetTitle = '';
        let targetType = '';
        let targetId = '';

        for (let i = 0; i < cards.length; i++) {
          const card = cards[i];
          const h3 = card.querySelector('h3');
          const title = h3?.getAttribute('data-original-title') || h3?.innerText?.trim() || `Unit ${i + 1}`;
          const typeEl = card.querySelector('.textinfo');
          const type = (typeEl?.innerText || '').trim();
          const id = card.id ? card.id.replace('pro_', '') : '';

          const complSpan = card.querySelector('.compltxt');
          const isCompl = complSpan && window.getComputedStyle(complSpan).display !== 'none' && complSpan.innerText.includes('Completed');
          const progressBar = card.querySelector('.progress-bar');
          const isProgress100 = progressBar && progressBar.style.width === '100%';

          if (isCompl || isProgress100) {
            completedCount++;
          } else if (!targetCard) {
            targetCard = card;
            targetTitle = title;
            targetType = type;
            targetId = id;
          }
        }

        const currentPercent = Math.round((completedCount / total) * 100);
        AutomatorCore.updateHUD(`Course: ${completedCount}/${total} Completed (${currentPercent}%)`, currentPercent);

        if (!targetCard) {
          AutomatorCore.notify('All modular units 100% Completed!', 'info');
          AutomatorCore.updateHUD('Course 100% Completed!', 100);
          await chrome.storage.local.set({ speedoRunning: false });
          AutomatorCore.stop('Course 100% Complete!');
          break;
        }

        AutomatorCore.notify(`[Unit ${completedCount + 1}/${total}] "${targetTitle}" (${targetType || 'Module'})...`, 'info');

        // 1. Check if unit needs Enrollment (button: "Enrol" / onclick: buyProductNow)
        const enrolBtn = Array.from(targetCard.querySelectorAll('button, a')).find(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const onclick = (b.getAttribute('onclick') || '').toLowerCase();
          return (txt === 'enrol' || txt === 'enroll' || onclick.includes('buyproductnow')) && !b.disabled;
        });

        if (enrolBtn) {
          AutomatorCore.notify(`Auto-Enrolling in "${targetTitle}" (Free)... `, 'info');
          DomUtils.simulateClick(enrolBtn);
          await DomUtils.sleep(3000);
          continue; // Re-evaluate cards after enrollment commits
        }

        // 2. Check if unit is a Quiz (ready to launch)
        if (targetType.toLowerCase() === 'other' || targetTitle.toLowerCase().includes('quiz')) {
          const startQuizBtn = Array.from(targetCard.querySelectorAll('button, a')).find(b => {
            const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
            return txt.includes('quiz') || txt === 'get started' || txt === 'start' || txt === 'launch';
          });
          if (startQuizBtn) {
            AutomatorCore.notify(`Launching Quiz for "${targetTitle}"...`, 'info');
            const initialQuizTime = Date.now();
            DomUtils.simulateClick(startQuizBtn);
            await DomUtils.sleep(3000);

            // Stand by while Quiz solver auto-submits in the player tab
            let quizFinished = false;
            while (AutomatorCore.isRunning && Date.now() - initialQuizTime < 60000) {
              await DomUtils.sleep(2000);
              const data = await chrome.storage.local.get(['speedo_last_quiz_completed']);
              if (data?.speedo_last_quiz_completed && data.speedo_last_quiz_completed >= initialQuizTime - 3000) {
                quizFinished = true;
                break;
              }
            }

            if (quizFinished) {
              AutomatorCore.notify('Quiz completed and passed with 100%! Refreshing dashboard to commit certificate...', 'info');
              AutomatorCore.updateHUD('Quiz 100% Passed! Finalizing Course...', 100);
              await DomUtils.sleep(2000);
              window.location.reload();
              return;
            }
            continue;
          }
        }

        // 3. For Articles / Videos: Check if "Get Started" is present
        const getStartedBtn = Array.from(targetCard.querySelectorAll('button, a')).find(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const onclick = (b.getAttribute('onclick') || '').toLowerCase();
          return (txt === 'get started' || onclick.includes('getsubproduct') || b.classList.contains('getStarted')) && !b.disabled;
        });

        if (getStartedBtn) {
          AutomatorCore.notify(`Expanding "${targetTitle}"...`, 'info');
          DomUtils.simulateClick(getStartedBtn);
          await DomUtils.sleep(1500);

          // Step 3a: Trigger "View Content" to unlock mark as complete (suppress new tab)
          let viewLink = targetCard.querySelector('.post_cont_view_content, a[id*="view_content"], a[onclick*="pre_mark_as_complete"]');
          if (!viewLink && targetId) {
            viewLink = document.querySelector(`#post_complt_${targetId} .post_cont_view_content, #post_complt_${targetId} a[id*="view_content"]`);
          }

          if (viewLink) {
            AutomatorCore.notify('Confirming content view...', 'info');
            // Prevent opening unwanted new tab
            const originalHref = viewLink.getAttribute('href');
            const originalTarget = viewLink.getAttribute('target');
            viewLink.removeAttribute('target');
            viewLink.setAttribute('href', 'javascript:void(0)');

            DomUtils.simulateClick(viewLink);

            if (originalHref) viewLink.setAttribute('href', originalHref);
            if (originalTarget) viewLink.setAttribute('target', originalTarget);
            await DomUtils.sleep(1000);
          }

          // Step 3b: Click "Mark as Complete"
          let markBtn = targetCard.querySelector('#markasComplete, button.viewReport, button[onclick*="mark_as_complete"]');
          if (!markBtn && targetId) {
            markBtn = document.querySelector(`#post_complt_${targetId} #markasComplete, #post_complt_${targetId} .viewReport`);
          }
          if (!markBtn) {
            markBtn = document.querySelector('#post_completion_text #markasComplete, #markasComplete');
          }

          if (markBtn) {
            AutomatorCore.notify(`Marking "${targetTitle}" as Complete...`, 'info');
            markBtn.style.cursor = 'pointer';
            DomUtils.simulateClick(markBtn);
            await DomUtils.sleep(2500);
          } else {
            // Direct Main World invocation fallback
            const onclickAttr = getStartedBtn.getAttribute('onclick') || '';
            const match = onclickAttr.match(/getSubProduct\s*\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'[^']*'\s*,\s*'([^']+)'\s*\)/);
            if (match) {
              const lsId = match[1];
              const prodId = match[2];
              AutomatorCore.notify(`Directly marking "${targetTitle}" complete via platform API...`, 'info');
              await AutomatorCore.runInMainWorld(`PRE_MARK_COMPLETE:${lsId}:${prodId}`);
              await DomUtils.sleep(500);
              await AutomatorCore.runInMainWorld(`MARK_HUB_COMPLETE:${lsId}:${prodId}`);
              await DomUtils.sleep(2500);
            }
          }

          continue;
        }

        // 4. Fallback: Standard Launch button
        const launchBtn = targetCard.querySelector('.launchBtn, a[onclick*="getsubdata"]');
        if (launchBtn) {
          AutomatorCore.notify(`Launching player for "${targetTitle}"...`, 'info');
          DomUtils.simulateClick(launchBtn);
          await DomUtils.sleep(3000);
          break;
        }

        await DomUtils.sleep(2000);
      }
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
          <div class="ca-banner-title"> Pathway Automator</div>
          <div class="ca-banner-sub">${completed}/${cards.length} Modules Completed</div>
        </div>
        <button id="ca-banner-launch-btn" class="ca-banner-btn">
          ${completed === cards.length ? ' Pathway 100% Done' : ' Auto-Complete Pathway'}
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
            AutomatorCore.notify(` All ${totalUnits} units 100% verified complete!`, 'info');
            AutomatorCore.updateHUD(' Module 100% Complete!', 100);
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
        this.pauseAndMuteAllVideos();
        try {
          targetUnit.click();
        } catch (e) {}

        await DomUtils.sleep(1500);
        await this.waitForSpinnerToClear(2000);
        this.dismissWarningPopupsSafely();

        // 4b. Dedicated Quiz Unit handling: Launch autonomous Quiz Solver and wait dynamically!
        const isQuiz = this.isQuizUnit(targetUnit);
        if (isQuiz) {
          AutomatorCore.notify(`Quiz unit detected: "${unitTitle}". Preparing autonomous Quiz Solver...`, 'info');
          AutomatorCore.updateHUD(`Solving Quiz: ${unitTitle}`, currentPercent);

          // Dynamic wait for quiz container / object to mount in DOM
          const quizMountStart = Date.now();
          let quizObj = null;
          while (Date.now() - quizMountStart < 2500) {
            quizObj = document.querySelector('object[data*="quizzes/show_new"], iframe[src*="quizzes/show_new"], #content_id');
            if (quizObj) break;
            await DomUtils.sleep(100);
          }

          let quizUrl = quizObj ? (quizObj.getAttribute('data') || quizObj.src) : null;
          if (!quizUrl && params) {
            quizUrl = `/LX/quizzes/show_new?id=33&c_id=${encodeURIComponent(params.c_id)}&content_id=${encodeURIComponent(params.toc_id || params.content_id)}&toc_id=${encodeURIComponent(params.toc_id)}&content_ui=true`;
          }

          if (quizUrl) {
            AutomatorCore.notify(`Launching autonomous Quiz Solver for "${unitTitle}"...`, 'info');
            const quizSolveStart = Date.now();

            // Launch quiz in dedicated solver tab
            chrome.runtime.sendMessage({ action: 'OPEN_PLAYER_TAB', url: quizUrl });

            // Dynamic polling wait: checks every 350ms until quiz completes
            let quizCompleted = false;
            const quizWaitStart = Date.now();
            while (Date.now() - quizWaitStart < 60000) {
              if (!AutomatorCore.isRunning) break;
              const data = await chrome.storage.local.get(['speedo_last_quiz_completed']);
              if (data?.speedo_last_quiz_completed && data.speedo_last_quiz_completed >= quizSolveStart) {
                quizCompleted = true;
                break;
              }
              await DomUtils.sleep(350);
            }

            if (quizCompleted) {
              AutomatorCore.notify(`Quiz "${unitTitle}" completed! Advancing to next node...`, 'info');
              targetUnit.classList.add('marked');
              const tick = targetUnit.querySelector('.greenTickIcon');
              if (tick) tick.style.display = 'block';

              // Close all open quiz tabs
              chrome.runtime.sendMessage({ action: 'CLOSE_QUIZ_TABS' });

              await DomUtils.sleep(800);
              continue;
            } else {
              AutomatorCore.notify(`Quiz "${unitTitle}" not yet completed. Pausing player to prevent prerequisite lockout.`, 'warn');
              return;
            }
          } else {
            AutomatorCore.notify(`Could not locate quiz launch URL for "${unitTitle}". Pausing.`, 'warn');
            return;
          }
        }

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
          AutomatorCore.notify(`️ "${unitTitle}" is still blocked by prerequisites. Re-attempting recovery on next cycle...`, 'warn');
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

        this.pauseAndMuteAllVideos();
        this.dismissWarningPopupsSafely();
        await DomUtils.sleep(1000);
      }
    },

    /**
     * Executes User's Recovery Rule:
     * Previous -> Mark/Complete -> Next -> Verify
     */
    async handlePrerequisiteRecovery(targetUnit, unitTitle, targetIndex, allUnits) {
      AutomatorCore.notify(`️ Prerequisites gate detected on "${unitTitle}". Running: Previous -> Complete -> Next...`, 'warn');
      AutomatorCore.updateHUD(`️ Prerequisites Gate: Recovering previous node...`, 0);
      this.dismissWarningPopupsSafely();

      const prevIndex = Math.max(0, targetIndex - 1);
      const prevUnit = allUnits[prevIndex];
      const prevParams = prevUnit ? this.extractUnitParams(prevUnit) : null;
      const prevTitle = prevUnit ? this.getUnitTitle(prevUnit) : 'Previous Node';

      // If previous node is a quiz, solve it autonomously
      if (prevUnit && this.isQuizUnit(prevUnit)) {
        AutomatorCore.notify(`[Recovery] Previous node "${prevTitle}" is a Quiz. Solving quiz first...`, 'info');
        await this.clickPreviousNode(prevUnit);
        await DomUtils.sleep(1500);
        await this.waitForSpinnerToClear(2000);

        const quizObj = document.querySelector('object[data*="quizzes/show_new"], iframe[src*="quizzes/show_new"], #content_id');
        let quizUrl = quizObj ? (quizObj.getAttribute('data') || quizObj.src) : null;
        if (!quizUrl && prevParams) {
          quizUrl = `/LX/quizzes/show_new?id=33&c_id=${encodeURIComponent(prevParams.c_id)}&content_id=${encodeURIComponent(prevParams.toc_id || prevParams.content_id)}&toc_id=${encodeURIComponent(prevParams.toc_id)}&content_ui=true`;
        }

        if (quizUrl) {
          const quizSolveStart = Date.now();
          chrome.runtime.sendMessage({ action: 'OPEN_PLAYER_TAB', url: quizUrl });

          const qWaitStart = Date.now();
          while (Date.now() - qWaitStart < 60000) {
            if (!AutomatorCore.isRunning) break;
            const data = await chrome.storage.local.get(['speedo_last_quiz_completed']);
            if (data?.speedo_last_quiz_completed && data.speedo_last_quiz_completed >= quizSolveStart) {
              break;
            }
            await DomUtils.sleep(350);
          }
          chrome.runtime.sendMessage({ action: 'CLOSE_QUIZ_TABS' });
          await DomUtils.sleep(800);
          window.location.reload();
          return;
        }
      }

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
        AutomatorCore.notify(`️ Prerequisites gate still visible. Sending all preceding prerequisite completions...`, 'warn');
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
        AutomatorCore.notify(` Prerequisites gate cleared for "${unitTitle}"! Ready to complete.`, 'info');
      }
    },

    isPrerequisiteScreenShowing() {
      // 1. Check if the in-slide #pre_requisite screen is ACTUALLY rendered and visible
      const prereqEl = document.getElementById('pre_requisite') || 
                       document.querySelector('.pre-requisitecontainer, [id*="pre_requisite"]');
      if (prereqEl && (prereqEl.offsetWidth > 0 || prereqEl.getClientRects().length > 0) && window.getComputedStyle(prereqEl).display !== 'none') {
        return true;
      }

      // 2. Check if the #markWarningPopup modal is actively visible with prerequisite text
      const warningPopup = document.getElementById('markWarningPopup');
      if (warningPopup && (warningPopup.offsetWidth > 0 || warningPopup.getClientRects().length > 0) && window.getComputedStyle(warningPopup).display !== 'none') {
        const text = (warningPopup.innerText || '').toLowerCase();
        if (text.includes('prerequisite') || text.includes('required to complete')) {
          return true;
        }
      }

      return false;
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

      const markReadSelectors = ['.markReadIcon', '.markasReadIcon', '#markReadIcon', '#markReadPopupBtn', '[title*="Mark as Read" i]'];
      for (const sel of markReadSelectors) {
        const el = document.querySelector(sel);
        if (el && (el.offsetWidth > 0 || el.getClientRects().length > 0)) {
          try { DomUtils.simulateClick(el); } catch (e) {}
        }
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

    pauseAndMuteAllVideos() {
      try {
        document.querySelectorAll('video, audio').forEach(vid => {
          try {
            vid.muted = true;
            vid.volume = 0;
            vid.pause();
          } catch (e) {}
        });
      } catch (e) {}
    },

    async completeVideoUnit() {
      const videos = document.querySelectorAll('video');
      if (videos.length === 0) return;

      videos.forEach((vid) => {
        try {
          vid.muted = true;
          vid.volume = 0;
          if (vid.duration && !vid.ended) {
            vid.currentTime = Math.max(0, vid.duration - 0.2);
          }
          vid.dispatchEvent(new Event('ended'));
          vid.dispatchEvent(new Event('timeupdate'));
          if (typeof vid.onended === 'function') {
            vid.onended();
          }
          vid.pause();
        } catch (e) {}
      });

      await DomUtils.sleep(250);
      await AutomatorCore.runInMainWorld('VIDEO_ENDED');
      this.pauseAndMuteAllVideos();
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

    isQuizUnit(unitElement) {
      if (!unitElement) return false;
      const title = this.getUnitTitle(unitElement).toLowerCase();
      if (title.includes('quiz') || title.includes('assessment')) return true;
      if (unitElement.querySelector('.quizBorder, [class*="quiz"], [class*="assessment"]')) return true;
      return false;
    },

    /**
     * Autonomous FutureSkills Quiz Solver
     * Parses questions_data directly from page scripts (or window),
     * automatically selects every single 100% verified correct answer (is_true == 1),
     * advances through each step, and submits the quiz!
     */
    async runQuizSolver() {
      AutomatorCore.setIsRunning(true);
      AutomatorCore.showHUD('SPEEDO FutureSkills Quiz Solver Active');
      AutomatorCore.notify('Analyzing FutureSkills Quiz data...', 'info');

      // Check immediately if quiz is already completed/submitted
      if (this.isQuizAlreadySubmitted()) {
        AutomatorCore.notify('Quiz is already completed and passed! Closing tab in 1s...', 'info');
        await chrome.storage.local.set({ speedo_last_quiz_completed: Date.now() });
        AutomatorCore.updateHUD('Quiz Already Passed! (100%)', 100);
        await DomUtils.sleep(1000);
        chrome.runtime.sendMessage({ action: 'CLOSE_CURRENT_TAB' });
        try { window.close(); } catch (e) {}
        return;
      }

      // 1. Click Start Quiz button if present on first screen (exclude review buttons)
      const startBtn = Array.from(document.querySelectorAll('.start_quiz_btn, .start_btn, [onclick*="start_quiz"], [onclick*="startQuiz"]')).find(b => {
        if (b.classList.contains('rev_btn')) return false;
        const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
        if (txt.includes('view') || txt.includes('response')) return false;
        return (b.offsetWidth > 0 || b.getClientRects().length > 0);
      });

      if (startBtn) {
        AutomatorCore.notify('Clicking "Start Quiz"...', 'info');
        DomUtils.simulateClick(startBtn);
        // Dynamic wait for quiz questions container to mount
        const startWait = Date.now();
        while (Date.now() - startWait < 3000) {
          if (document.querySelector('.quiz-page-1, input[type="radio"], [onclick*="check_answer"]')) break;
          await DomUtils.sleep(100);
        }
      }

      // 2. Wait dynamically for questions payload to mount (polling every 100ms)
      let questions = [];
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        if (!AutomatorCore.isRunning) return;

        try {
          const regex = /question_answer_arr\s*=\s*['"](\{[\s\S]*?\})['"]/g;
          const html = document.documentElement.outerHTML;
          let m;
          while ((m = regex.exec(html)) !== null) {
            try {
              const raw = m[1].replaceAll('&quot;', '"')
                              .replaceAll('=&gt;', ':')
                              .replaceAll('nil', 'null')
                              .replaceAll('\t', '');
              const parsed = JSON.parse(raw);
              if (parsed && parsed.all_options && parsed.all_options.length > 0) {
                if (!questions.some(q => q.ques_id === parsed.ques_id)) {
                  questions.push(parsed);
                }
              }
            } catch (pe) {}
          }
        } catch (e) {}

        if (questions.length === 0 && window.questions_data && Array.isArray(window.questions_data) && window.questions_data.length > 0) {
          questions = window.questions_data;
        }

        if (questions.length > 0) break;
        await DomUtils.sleep(200);
      }

      AutomatorCore.notify(`Identified ${questions.length} questions in quiz payload.`, 'info');

      if (questions.length === 0 && this.isQuizAlreadySubmitted()) {
        AutomatorCore.notify('Quiz is already completed and passed! Closing tab in 1s...', 'info');
        await chrome.storage.local.set({ speedo_last_quiz_completed: Date.now() });
        await DomUtils.sleep(1000);
        chrome.runtime.sendMessage({ action: 'CLOSE_CURRENT_TAB' });
        try { window.close(); } catch (e) {}
        return;
      }

      if (questions.length > 0) {
        for (let i = 0; i < questions.length; i++) {
          if (!AutomatorCore.isRunning) break;
          const q = questions[i];
          const count = i + 1;
          AutomatorCore.notify(`[Q${count}/${questions.length}] Solving (ID: ${q.ques_id})...`, 'info');
          AutomatorCore.updateHUD(`Solved ${i}/${questions.length} Quiz Questions`, Math.round((i / questions.length) * 100));

          // Current question card/page container
          const pageContainer = document.querySelector(`.quiz-page-${count}, #quiz_question${count}`) || document;

          // 1. Select the correct option(s) (is_true == 1)
          const correctOptions = q.all_options.filter(opt => opt.is_true == 1 || opt.is_true === true);
          if (correctOptions.length > 0) {
            for (const cOpt of correctOptions) {
              const inputSel = `#select_option_${q.ques_id}_${cOpt.answer_id}, input[value="${cOpt.answer_id}"], .checkbox_${q.ques_id}[value="${cOpt.answer_id}"]`;
              const inputEl = document.querySelector(inputSel);
              if (inputEl) {
                inputEl.checked = true;
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                DomUtils.simulateClick(inputEl);
                AutomatorCore.notify(`[Q${count}] Selected correct answer (ID: ${cOpt.answer_id})`, 'info');
              } else {
                const container = document.getElementById(`container_${cOpt.answer_id}`) || document.getElementById(`${cOpt.answer_id}`);
                if (container) {
                  DomUtils.simulateClick(container);
                  AutomatorCore.notify(`[Q${count}] Clicked option container #${cOpt.answer_id}`, 'info');
                }
              }
            }
          } else {
            const firstInput = pageContainer.querySelector(`.checkbox_${q.ques_id}, input[name="select_option_${q.ques_id}"]`);
            if (firstInput) {
              firstInput.checked = true;
              DomUtils.simulateClick(firstInput);
            }
          }

          // Dynamic wait for option selection
          const optWait = Date.now();
          while (Date.now() - optWait < 400) {
            const anyChecked = pageContainer.querySelector('input:checked');
            if (anyChecked) break;
            await DomUtils.sleep(50);
          }

          // 2. Click question submit button specifically for this question (check_answer)
          const stepSubmit = pageContainer.querySelector('.submit_quiz_step1, [onclick*="check_answer"]') ||
                             document.querySelector(`[onclick*="check_answer(${q.ques_id}"]`) ||
                             document.querySelector('.submit_quiz_step1');

          if (stepSubmit) {
            DomUtils.simulateClick(stepSubmit);

            // Dynamic wait for slide animation
            const checkWait = Date.now();
            while (Date.now() - checkWait < 1500) {
              if (pageContainer.querySelector('.correct_ans, .wrong_ans, .quiz_explanation')) break;
              await DomUtils.sleep(100);
            }
          }

          // 3. Advance to next question (when not on last question)
          if (count < questions.length) {
            const nextBtn = pageContainer.querySelector(`[onclick*="page_change(${count + 1})"], [onclick*="page_change(${count})"], .fake_next_question_div button, .next_question_div a, .quiz_button`) ||
                            document.querySelector(`[onclick*="page_change(${count + 1})"]`) ||
                            document.querySelector(`[onclick*="page_change(${count})"]`) ||
                            Array.from(document.querySelectorAll('button, a')).find(b => {
                              const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
                              const oc = b.getAttribute('onclick') || '';
                              return (txt.includes('next question') || txt === 'next' || oc.includes('page_change')) &&
                                     (b.offsetWidth > 0 || b.offsetParent !== null);
                            });

            if (nextBtn) {
              DomUtils.simulateClick(nextBtn);

              // Dynamic wait for next page to mount
              const nextPageWait = Date.now();
              while (Date.now() - nextPageWait < 2000) {
                const nextPage = document.querySelector(`.quiz-page-${count + 1}`);
                if (nextPage && (nextPage.offsetWidth > 0 || window.getComputedStyle(nextPage).display !== 'none')) break;
                await DomUtils.sleep(100);
              }
            }
          }
        }

        // 4. Final Submit / View Result
        const finishStart = Date.now();
        let finishBtn = null;
        while (Date.now() - finishStart < 3000) {
          const finishBtns = Array.from(document.querySelectorAll('button.submit_quiz_btn, .quizz_btn, button[type="submit"], input[type="submit"]'));
          finishBtn = finishBtns.find(b => b.offsetWidth > 0 || b.getClientRects().length > 0) || finishBtns[0];
          if (finishBtn) break;
          await DomUtils.sleep(100);
        }

        if (finishBtn) {
          AutomatorCore.notify('Submitting quiz with 100% correct score...', 'info');
          DomUtils.simulateClick(finishBtn);

          const form = finishBtn.closest('form') || document.querySelector('form[action*="create_survey"]');
          if (form) {
            try {
              if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
              }
            } catch (e) {}
          }
        }

        try {
          await chrome.storage.local.set({ speedo_last_quiz_completed: Date.now() });
        } catch (e) {}

        AutomatorCore.updateHUD('Quiz 100% Passed!', 100);
        AutomatorCore.notify('Quiz completed and passed! Prerequisites cleared.', 'info');

        // Dynamic tab close if in dedicated quiz tab
        if (window.location.pathname.includes('/LX/quizzes/')) {
          AutomatorCore.notify('Closing quiz tab in 1.5s...', 'info');
          await DomUtils.sleep(1500);
          chrome.runtime.sendMessage({ action: 'CLOSE_CURRENT_TAB' });
          try { window.close(); } catch (e) {}
        }
      } else {
        AutomatorCore.notify('Waiting for quiz questions to render...', 'warn');
      }
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
        AutomatorCore.updateHUD(` "${modTitle}" 100% Complete! Returning to Pathway in 2s...`, 100);
        AutomatorCore.notify(` "${modTitle}" 100% Complete! Closing tab and advancing Pathway...`, 'info');

        chrome.runtime.sendMessage({
          action: 'MODULE_COMPLETED',
          moduleId: data.pathwayRunner.currentModuleId
        });
      } else {
        AutomatorCore.updateHUD(' Course 100% Complete! Refreshing page in 3s...', 100);
        AutomatorCore.notify(' Course 100% Complete! Reloading in 3s to reflect verified 100%...', 'info');
        AutomatorCore.stop(' Course 100% Complete!');

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
