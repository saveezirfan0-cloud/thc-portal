/* THC wireframes — tiny helper: state switchers, tabs, sidebar toggle.
   Not product code. Keeps every wireframe page static-HTML friendly. */
(function () {
  // State switcher: <div class="wf-states" data-target="board"> <button data-state="a">…
  // Sections: <section data-state-of="board" data-state="a">
  function setState(group, state) {
    document.querySelectorAll('[data-state-of="' + group + '"]').forEach(function (el) {
      el.classList.toggle('hide', el.getAttribute('data-state') !== state);
    });
    document.querySelectorAll('.wf-states[data-target="' + group + '"] button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-state') === state);
    });
    try { history.replaceState(null, '', '#' + group + '=' + state); } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('.wf-states button');
    if (b) { setState(b.closest('.wf-states').getAttribute('data-target'), b.getAttribute('data-state')); return; }
    var t = e.target.closest('[data-tab]');
    if (t) {
      e.preventDefault();
      var grp = t.getAttribute('data-tabgroup');
      document.querySelectorAll('[data-tabgroup="' + grp + '"]').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      document.querySelectorAll('[data-tabpanel="' + grp + '"]').forEach(function (p) {
        p.classList.toggle('hide', p.getAttribute('data-tab') !== t.getAttribute('data-tab'));
      });
      return;
    }
    var m = e.target.closest('[data-toggle-sidebar]');
    if (m) { document.querySelector('.sidebar').classList.toggle('open'); }
    var o = e.target.closest('[data-open]');
    if (o) { e.preventDefault(); var el = document.getElementById(o.getAttribute('data-open')); if (el) el.classList.remove('hide'); }
    var c = e.target.closest('[data-close]');
    if (c) { e.preventDefault(); var el2 = document.getElementById(c.getAttribute('data-close')); if (el2) el2.classList.add('hide'); }
  });
  // init: first state of each group, or from hash
  document.addEventListener('DOMContentLoaded', function () {
    var hash = {};
    (location.hash || '').replace('#', '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) hash[p[0]] = p[1]; });
    document.querySelectorAll('.wf-states').forEach(function (g) {
      var name = g.getAttribute('data-target');
      var first = g.querySelector('button');
      setState(name, hash[name] || (first && first.getAttribute('data-state')));
    });
  });
})();
