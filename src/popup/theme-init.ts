// Runs before the React app mounts so the correct theme is applied without a
// flash of the wrong theme. This MUST live in its own module and be loaded via
// a <script type="module" src="..."> tag rather than an inline <script> block —
// MV3 extension pages enforce a strict CSP that disallows inline script
// execution outright, and @crxjs's dev-mode CSP (used for HMR) doesn't grant
// exceptions for it either. An external module is the only approach that works
// identically in `npm run dev` and `npm run build`.
(function initThemeFromStoredSettings() {
  try {
    chrome.storage.local.get('settings', (data) => {
      const settings = (data.settings || {}) as any;
      if (settings.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (settings.theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      }
    });
  } catch (e) {
    // chrome.storage can be transiently unavailable (e.g. mid hot-reload) — fail silently,
    // the app will still render with the default (light) theme.
  }
})();
