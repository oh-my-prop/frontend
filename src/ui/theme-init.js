// Classic (non-module) script loaded in <head> so the saved theme is applied
// before the first paint — no flash of the wrong theme. Kept tiny on purpose.
// Without a saved choice nothing is set and the CSS follows the OS preference.
(function applySavedTheme() {
  try {
    var saved = localStorage.getItem('oh-my-prop.theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (error) {
    // Storage blocked (private mode, policy): follow the OS preference.
  }
}());
