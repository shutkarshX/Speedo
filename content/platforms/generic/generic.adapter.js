/**
 * Platform Adapter: Generic Course Platform (Fallback)
 * Standard HTML5 video completion & universal "Next" / "Continue" navigation.
 * Used when no specialized platform adapter matches the current site.
 */
(function () {
  const GenericAdapter = {
    id: 'generic',
    name: 'Generic Course Player',
    description: 'Universal fallback for HTML5 video completion and standard Next/Continue navigation.',

    matches() {
      // Generic adapter acts as universal fallback
      return true;
    },

    async init() {
      console.log('[Generic Adapter] Initialized for page:', window.location.hostname);
    },

    async start() {
      if (AutomatorCore.isRunning) return;
      AutomatorCore.setIsRunning(true);

      AutomatorCore.showHUD('Running Universal Automator...');
      AutomatorCore.notify(`Universal automator started on ${window.location.hostname}`, 'info');

      try {
        const maxSteps = 50;
        let step = 0;

        while (AutomatorCore.isRunning && step < maxSteps) {
          step++;

          // 1. Fast-forward any HTML5 video
          const videos = Array.from(document.querySelectorAll('video'));
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

          if (videos.length > 0) {
            AutomatorCore.notify('HTML5 video completed.', 'info');
            await DomUtils.sleep(1000);
          }

          // 2. Look for Next / Continue / Mark Complete buttons
          const nextBtn = this.findNextButton();
          if (nextBtn) {
            AutomatorCore.notify(`Advancing via "${nextBtn.innerText?.trim() || 'Next'}"...`, 'info');
            DomUtils.simulateClick(nextBtn);
            await DomUtils.sleep(2500);
          } else {
            AutomatorCore.notify('No more "Next" buttons detected. Standing by...', 'info');
            break;
          }
        }
      } catch (err) {
        AutomatorCore.notify(`Error: ${err.message}`, 'error');
      } finally {
        AutomatorCore.setIsRunning(false);
      }
    },

    findNextButton() {
      const selectors = [
        'button.next',
        '.nxt_btn',
        '._nxtStep',
        '[aria-label*="next" i]',
        'button:has-text("Next")',
        'a:has-text("Next")'
      ];

      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el;
        } catch (e) {}
      }

      const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      return all.find(el => {
        if (!el.offsetParent) return false;
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        return (txt === 'next' || txt === 'next unit' || txt === 'continue' || txt === 'mark as complete');
      }) || null;
    },

    onStop(reason) {
      console.log('[Generic Adapter] Stopped:', reason);
    }
  };

  if (window.PlatformRegistry) {
    window.PlatformRegistry.register(GenericAdapter);
  }
})();
