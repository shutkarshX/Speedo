/**
 * Platform Registry
 * Manages platform adapters and automatically resolves the correct adapter
 * based on current URL and DOM signatures.
 */
window.PlatformRegistry = (function () {
  const registeredPlatforms = [];

  function register(platform) {
    if (!platform || !platform.id) {
      console.warn('[PlatformRegistry] Invalid platform registration attempt:', platform);
      return;
    }
    // Prevent duplicate registrations
    const existingIndex = registeredPlatforms.findIndex(p => p.id === platform.id);
    if (existingIndex >= 0) {
      registeredPlatforms[existingIndex] = platform;
    } else {
      registeredPlatforms.push(platform);
    }
    console.log(`[PlatformRegistry] Registered platform: "${platform.name}" (${platform.id})`);
  }

  function getAll() {
    return [...registeredPlatforms];
  }

  /**
   * Resolves the matching platform for the given URL and document
   */
  function detectPlatform(url = window.location.href, doc = document) {
    // 1. Check specialized platforms first (excluding 'generic')
    for (const platform of registeredPlatforms) {
      if (platform.id === 'generic') continue;
      try {
        if (typeof platform.matches === 'function' && platform.matches(url, doc)) {
          return platform;
        }
      } catch (err) {
        console.warn(`[PlatformRegistry] Error testing platform ${platform.id}:`, err);
      }
    }

    // 2. Fall back to generic platform if registered
    const generic = registeredPlatforms.find(p => p.id === 'generic');
    return generic || null;
  }

  return {
    register,
    getAll,
    detectPlatform
  };
})();
