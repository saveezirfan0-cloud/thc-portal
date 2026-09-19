/* THC wireframes — helpers: theme/style switch, state switchers, tabs, sidebar toggle.
   Not product code. Keeps every wireframe page static-HTML friendly. */
(function () {
  // ---------- theme (dark | light) × style (warm | scope) ----------
  var root = document.documentElement;
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // ONE switch: light mode = Warm look, dark mode = Scope §1.6 look (product decision, ADR-0003 v3).
  // ?style=&theme= query params still work for rendering any of the four combinations.
  function apply() {
    var q = new URLSearchParams(location.search);
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var mode = q.get('mode') || stored('thc-mode') || (prefersDark ? 'dark' : 'light');
    var theme = q.get('theme') || mode;
    var style = q.get('style') || (theme === 'dark' ? 'scope' : 'warm');
    root.setAttribute('data-theme', theme); root.setAttribute('data-style', style);
    document.querySelectorAll('.wf-theme button').forEach(function (b) { b.classList.toggle('on', theme === b.dataset.value); });
  }
  apply();
  function switchUI() {
    var html = '<span class="wf-theme" title="Light = Warm look · Dark = Scope §1.6 look"><button data-axis="mode" data-value="light">Light · Warm</button><button data-axis="mode" data-value="dark">Dark · Scope</button></span>';
    var bar = document.querySelector('.wf-bar');
    var host;
    if (bar) { host = document.createElement('span'); host.className = 'row'; host.style.gap = '8px'; host.innerHTML = html; bar.insertBefore(host, bar.querySelector('.spacer') ? bar.querySelector('.spacer').nextSibling : null); }
    else { host = document.createElement('div'); host.className = 'wf-float'; host.innerHTML = html; document.body.appendChild(host); }
    apply();
  }

  // ---------- state switcher / tabs / sidebar / modals ----------
  function setState(group, state) {
    document.querySelectorAll('[data-state-of="' + group + '"]').forEach(function (el) { el.classList.toggle('hide', el.getAttribute('data-state') !== state); });
    document.querySelectorAll('.wf-states[data-target="' + group + '"] button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-state') === state); });
    try { history.replaceState(null, '', '#' + group + '=' + state); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var th = e.target.closest('.wf-theme button');
    if (th) { store('thc-mode', th.dataset.value); try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} apply(); return; }
    var b = e.target.closest('.wf-states button');
    if (b) { setState(b.closest('.wf-states').getAttribute('data-target'), b.getAttribute('data-state')); return; }
    var t = e.target.closest('[data-tab]');
    if (t) {
      e.preventDefault();
      var grp = t.getAttribute('data-tabgroup');
      document.querySelectorAll('[data-tabgroup="' + grp + '"]').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('[data-tabpanel="' + grp + '"]').forEach(function (p) { p.classList.toggle('hide', p.getAttribute('data-tab') !== t.getAttribute('data-tab')); });
      return;
    }
    var m = e.target.closest('[data-toggle-sidebar]');
    if (m) { document.querySelector('.sidebar').classList.toggle('open'); }
    var o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); var el = document.getElementById(o.getAttribute('data-open')); if (el) el.classList.remove('hide'); }
    var c = e.target.closest('[data-close]');
    if (c) { e.preventDefault(); var el2 = document.getElementById(c.getAttribute('data-close')); if (el2) el2.classList.add('hide'); }
  });
  document.addEventListener('DOMContentLoaded', function () {
    switchUI();
    var hash = {};
    (location.hash || '').replace('#', '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) hash[p[0]] = p[1]; });
    document.querySelectorAll('.wf-states').forEach(function (g) {
      var name = g.getAttribute('data-target'); var first = g.querySelector('button');
      setState(name, hash[name] || (first && first.getAttribute('data-state')));
    });
  });
})();
