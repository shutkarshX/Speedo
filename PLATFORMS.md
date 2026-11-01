# Multi-Platform Adapter Architecture

The extension is organized using a **Platform Adapter Pattern**. Each learning platform is isolated into its own dedicated "box" (directory) under `content/platforms/`.

```
SPPEDO/
├── background/
│   └── service-worker.js         # Central background broker, CSP-safe execution, tab creation
├── content/
│   ├── core/
│   │   ├── automator-core.js     # Shared HUD, notifications, AI bridge, MAIN world runner
│   │   └── platform-registry.js  # Dynamic platform detector & registry
│   ├── platforms/
│   │   ├── futureskills/         # 📦 FUTURESKILLS PRIME ISOLATED BOX
│   │   │   └── futureskills.adapter.js # Pathway loop, course completer, prerequisite recovery
│   │   └── generic/              # 📦 UNIVERSAL FALLBACK BOX
│   │       └── generic.adapter.js      # Standard HTML5 video completion & Next button handler
│   ├── content.css               # Shared HUD & visual overlays
│   ├── content.js                # Core dispatcher: resolves active platform & routes commands
│   └── page-guard.js             # Runs at document_start in MAIN world: stops modal dialogs
├── popup/                        # Extension popup UI with dynamic platform badge
├── utils/
│   └── dom-helpers.js            # Shared DOM utility helpers
└── manifest.json
```

---

## 🚀 How to Add a New Learning Site (Without Touching FutureSkills)

When you want to add support for a new site (e.g., *Coursera*, *Udemy*, *Infosys Springboard*, *TCS iON*):

1. **Create a new folder:**
   `content/platforms/<new-platform-name>/`

2. **Add `<new-platform-name>.adapter.js`:**
   ```javascript
   (function () {
     const MyNewPlatformAdapter = {
       id: 'my-platform',
       name: 'My Platform Name',
       description: 'Automator for My Platform',

       // Detection rule: return true when current page matches this site
       matches(url = window.location.href, doc = document) {
         return url.includes('myplatform.com');
       },

       async init() {
         // Runs when tab loads (e.g., check resume state)
       },

       async start() {
         // Core automation flow for this site
         AutomatorCore.showHUD('Running My Platform Automator...');
         AutomatorCore.notify('Starting...', 'info');
         // ... custom unit completion / video / quiz logic ...
       },

       onStop(reason) {
         // Cleanup if user clicks Stop
       }
     };

     // Register with the global registry
     if (window.PlatformRegistry) {
       window.PlatformRegistry.register(MyNewPlatformAdapter);
     }
   })();
   ```

3. **Declare the new adapter in [`manifest.json`](file:///c:/Users/Roger/Desktop/SPPEDO/manifest.json):**
   Add `"content/platforms/<new-platform-name>/<new-platform-name>.adapter.js"` to the `content_scripts.js` array before `content/content.js`.

---

## Benefits of this Architecture
* **100% Isolation:** FutureSkills Prime files are completely separated. Modifying or adding other sites will **never** break FutureSkills Prime.
* **Auto-Detection:** When the user navigates to any URL, the extension automatically activates the appropriate platform adapter.
* **Shared Engine:** All platforms reuse the tested HUD, live logging, CSP-safe execution, and Page Guard protection.
