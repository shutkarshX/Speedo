/**
 * Shared DOM and Automation Helper Utilities
 */

window.DomUtils = window.DomUtils || {
  /**
   * Sleep for a specified number of milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Random delay between min and max milliseconds to simulate human behavior
   */
  async randomDelay(min = 800, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return this.sleep(delay);
  },

  /**
   * Wait for an element matching a selector to appear in the DOM
   */
  waitForElement(selector, timeoutMs = 10000, parent = document) {
    return new Promise((resolve, reject) => {
      const existing = parent.querySelector(selector);
      if (existing) {
        return resolve(existing);
      }

      const observer = new MutationObserver(() => {
        const el = parent.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(parent, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for selector: "${selector}"`));
      }, timeoutMs);
    });
  },

  /**
   * Safely dispatch click without smooth-scroll layout thrashing or CSP javascript: violations
   */
  simulateClick(element) {
    if (!element) return false;

    try {
      if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'nearest' });
      }
    } catch (e) {}

    try {
      const href = element.getAttribute ? element.getAttribute('href') : null;
      const isJsHref = typeof href === 'string' && href.trim().toLowerCase().startsWith('javascript:');
      const parentJsAnchor = element.closest ? element.closest('a[href^="javascript:" i], a[href^="JAVASCRIPT:"]') : null;

      if (isJsHref || parentJsAnchor) {
        const targetAnchor = (element.tagName === 'A' && isJsHref) ? element : parentJsAnchor;
        const origHref = targetAnchor.getAttribute('href');
        const jsCode = origHref ? origHref.replace(/^javascript:/i, '').trim() : '';

        // Temporarily strip href so Chrome cannot attempt javascript: URL navigation
        targetAnchor.removeAttribute('href');

        const evt = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        element.dispatchEvent(evt);

        // Restore original href
        if (origHref !== null) {
          targetAnchor.setAttribute('href', origHref);
        }

        // Safely execute actual javascript: actions in Main World where permitted
        if (jsCode && jsCode !== 'void(0)' && jsCode !== 'void(0);' && jsCode !== ';' && window.AutomatorCore?.runInMainWorld) {
          window.AutomatorCore.runInMainWorld(`EXEC_ONCLICK:${jsCode}`);
        }

        return true;
      }
      element.click();
    } catch (e) {}

    return true;
  },

  /**
   * Safely set text value and dispatch input/change events for reactive frameworks
   */
  simulateInput(inputElement, value) {
    if (!inputElement) return false;

    inputElement.focus();
    inputElement.value = value;

    ['input', 'change'].forEach((eventType) => {
      const event = new Event(eventType, { bubbles: true });
      inputElement.dispatchEvent(event);
    });

    return true;
  }
};
