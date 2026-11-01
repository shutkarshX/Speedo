# Target Site Specification & Automation Blueprint

## 1. Platform Details
- **Website Name / Platform:** FutureSkills Prime (iHUB / iEvolve LMS by EdCast / TCS)
- **Course Player URL Pattern:** `https://www.futureskillsprime.in/LX/content_players/content_home_new*`
- **Pathway Dashboard URL Pattern:** `https://www.futureskillsprime.in/iDH/fsp/Dashboard/Products_detail/*`
- **Example Journey:** Adobe Creativity and Generative AI Pathway (12 Modules)

---

## 2. Multi-Module Pathway Architecture (`/Dashboard/Products_detail/*`)
- **Module Cards:**
  - Container: `.allActiveProd` (e.g. `div.allActiveProd[id^="pro_"]`)
  - Product ID: Extracted from element `id="pro_259822319"` or `onclick="getsubdata('259822319')"`
  - Module Title: `h3[data-original-title]` or `h3` text
- **Completion Detection:**
  - Completed: Card contains `<span class="compltxt ..."><i class="rightCirclIcon"></i>Completed</span>` OR `.progress-bar` has `style="width: 100%;"` with button `Retake`.
  - Incomplete: Lacks visible `.compltxt` and progress is `< 100%` or button has text `Launch`.
- **Launch Trigger:**
  - Button element: `a.btn.launchBtn` with `onclick="getsubdata('PRODUCT_ID')"`.
  - Native click + Main world execution: `window.getsubdata(PRODUCT_ID)`.

---

## 3. Inter-Tab Pathway Handshake Lifecycle
1. **Pathway Tab:**
   - Detects all modules and finds the first incomplete one.
   - Sets `pathwayRunner: { active: true, pathwayUrl: ..., currentModuleId: ... }` in `chrome.storage.local`.
   - Clicks `.launchBtn`, opening the course player tab.
2. **Course Player Tab:**
   - Detects `pathwayRunner.active === true` upon load.
   - Shows HUD: `🚀 Pathway Mode: Auto-starting [Module Title] in 3s...`.
   - Completes all TOC units sequentially (videos, reading, quizzes, backend `content_complete`).
   - Once all units are completed, sends `MODULE_COMPLETED` to the background service worker.
   - Closes itself after 2s.
3. **Background Service Worker:**
   - Receives `MODULE_COMPLETED`.
   - Closes player tab (`chrome.tabs.remove(playerTabId)`).
   - Activates and reloads the Pathway tab.
4. **Pathway Tab (Resumed):**
   - Reloads fresh completion status from backend.
   - Rescans modules, advances to the next incomplete module, and launches it.
   - Repeats until all modules reach 100% completion!

---

## 4. Course Player Structure & TOC Architecture (`/LX/content_players/*`)
- **Table of Contents (Sidebar):**
  - Container: `#content_players_toc` / `.accordion_head`, `.acc_2_detail`
  - Unit items: `.innerDefault` (e.g., `div.inner.innerDefault[id^="page_unit_toc_"]`)
  - Attributes:
    - `id`: e.g. `page_unit_toc_24396_content_players_1153`
    - `data-attr`: e.g. `contents_1153`
    - `onclick`: `content_url('/LX/content_players/content_player_stagger_new?c_id=...&content_id=1153&toc_id=24396...', ...)`
  - Completion Status:
    - Completed: has class `.marked` (e.g. `.innerDefault.marked`)
    - Incomplete: lacks class `.marked` (e.g. `.innerDefault:not(.marked)`)

---

## 5. Unit Completion Mechanism
FutureSkills Prime marks content complete in two ways:
1. **Video Units:**
   - On video slides, `.togBtn` is `disabled="disabled"` until the video ends.
   - When the video ends, the site runs `on_video_ended()`, which calls `markings()`.
   - `completeVideoUnit()` sets `currentTime = duration - 0.2`, fires `ended`, and dispatches `on_video_ended()` via `EXEC_IN_MAIN_WORLD`.

2. **Reading / Non-Video Units:**
   - Toggle switch element: `input.togBtn` or `.markReadIcon`.
   - Dispatches `mark_unmark_content("No")`.

3. **Backend Direct Completion:**
   - `GET /LX/contents/content_complete?c_id={c_id}&content_id={toc_id}&id={content_id}&content_activity_completed_count=0&total_content_activity_count=0`
   - Immediately commits unit completion to LMS database.

4. **Watchdogs & Anti-Hang Guards:**
   - `waitForSpinnerToClear(5000)`: If loading spinner (`.mainLoader`, `.loader_wrapper`) hangs >5s, triggers auto-recovery reload with `autoResumeCourse` state.
   - Safe warning modal dismissal: hides `#markWarningPopup` and `#overlay` via CSS, never clicks `.ApplyButton` (which closes the course window).

---

## 6. Platform: Infosys Springboard (Wingspan / Lex LMS)
- **Domain:** `https://infyspringboard.onwingspan.com`
- **Course Overview / TOC:** `/web/en/app/toc/<lex_auth_id>/overview`
- **Content Viewer:** `/web/en/viewer/<content_type>/<lex_auth_id>?collectionType=Course&collectionId=<lex_auth_id>&pathId=<lex_auth_id>`
- **Example Course:** *Computational Problem Solving* (`lex_auth_0131149320724398081685_shared`)

### Viewer Component Selectors:
1. **Video Player:**
   - Tech: Video.js HTML5 video
   - Selector: `video.vjs-tech, #vjs_video_3_html5_api`
   - Complete Action: Fast-forward to `duration - 0.2`, dispatch `ended`, click `button.vjs-done-button`
2. **Mark as Complete Button:**
   - Selector: `button[aria-label="mark as complete"], button.mark-as-complete-mini, [mattooltip="Mark as Complete"]`
   - Icon: `<mat-icon>done_all</mat-icon>`
3. **Next Content Navigation Button:**
   - Selector: `button[aria-label="next content"], button.navigation-btn-frwd, .navigation-btn-frwd`
   - Icon: `<mat-icon>arrow_forward_ios</mat-icon>`
4. **Table of Contents (Sidebar):**
   - Tab: `div[role="tab"]` ("Contents")
   - Container: `ws-viewer-toc .toc-scrollable-content`
   - Units: `.flat-list` with `.content-title`
