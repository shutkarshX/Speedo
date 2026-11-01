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
   * Safely dispatch click without smooth-scroll layout thrashing
   */
  simulateClick(element) {
    if (!element) return false;

    try {
      if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'nearest' });
      }
    } catch (e) {}

    try {
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
