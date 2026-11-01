# AI Development Rules & Project Context

> **CRITICAL DIRECTIVE FOR ALL AI AGENTS WORKING ON THIS CODEBASE:**
> Read this file **first** before touching any code. 
> To prevent code confusion, hallucinations, or breaking existing logic:
> 1. Check `TASK_STATE.md` to see the current stage and what was done last.
> 2. Read `SITE_SPEC.md` to understand how the target site operates.
> 3. Never overwrite files wholesale without preserving existing working logic.
> 4. Keep code modular (do not dump thousands of lines into a single `content.js`).
> 5. Follow Chrome Extension **Manifest V3 (MV3)** rules strictly.

---

## 1. Project Identity & Goal
- **Name:** Course Automator / Test Solver Extension
- **Platform:** Google Chrome Extension (**Manifest V3**)
- **Objective:** Single-click completion of courses, modules, and tests/quizzes on target web platforms.

---

## 2. Chrome Manifest V3 Constraints (Do Not Violate)
1. **Background Scripts are Service Workers:**
   - They are ephemeral and can terminate when idle.
   - Do NOT store persistent global memory in the background worker. Use `chrome.storage.local` or communicate directly with content scripts.
   - No `window` or `document` object exists in the service worker.
2. **Strict Content Security Policy (CSP):**
   - No `eval()` or string-to-code execution.
   - No inline `<script>` tags created in DOM (`document.createElement('script')` with `.textContent`). FutureSkills Prime and MV3 block them.
   - To invoke functions in the page's realm (`window.on_video_ended`, `window.markings`), send message `EXEC_IN_MAIN_WORLD` to `background/service-worker.js`, which executes them CSP-safely via `chrome.scripting.executeScript({ world: 'MAIN' })`.
3. **Execution Contexts:**
   - **Popup (`popup/`):** The extension UI when clicking the extension icon. Closes when clicking outside.
   - **Content Script (`content/`):** Runs inside the target course webpage with access to the DOM, but in an isolated JavaScript realm.
   - **Injected/Page Script (`injected/`):** If needed to hook into window global variables or page-level APIs.
   - **Service Worker (`background/`):** Orchestrator, message router, tab manager.

---

## 3. Communication Protocol (Message Passing)
Always use structured messages:
```javascript
// Message format standard
{
  action: "START_AUTOMATION" | "SOLVE_TEST" | "PAUSE" | "GET_STATUS",
  payload: { ... }
}
```

---

## 4. Code Organization Standards
- Keep automation steps atomic (e.g., `findQuestions()`, `selectAnswers()`, `submitTest()`).
- Always use human-like delays (`randomDelay(min, max)`) between automated clicks to avoid detection or race conditions.
- Implement robust element queries with retries (`waitForElement(selector, timeout)`).
