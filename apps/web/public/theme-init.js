// Aplica el tema guardado antes del primer pintado (evita el parpadeo).
// Es un archivo externo (no inline) para poder mantener una CSP estricta: script-src 'self'.
try {
  var t = localStorage.getItem('econ-theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {}
