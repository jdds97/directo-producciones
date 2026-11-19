// Sentido de la transición entre páginas (Atrás/Adelante). Debe ser un script clásico y temprano: `pagereveal` se emite
// en el primer pintado, antes de que lleguen los módulos. Sin soporte de view transitions estos eventos no existen.
(function () {
  function sense(a) {
    if (!a) return null;
    if (a.navigationType === 'reload' || (a.from && a.from.url === a.entry.url && a.navigationType !== 'traverse')) return 'skip';
    if (a.navigationType === 'traverse' && a.from) return a.entry.index < a.from.index ? 'back' : 'forward';
    return 'forward';
  }
  function tune(vt, a) {
    var s = vt && sense(a);
    if (!s) return;
    if (s === 'skip') vt.skipTransition(); else vt.types.add(s);
  }
  addEventListener('pageswap', function (e) { tune(e.viewTransition, e.activation); });
  addEventListener('pagereveal', function (e) { tune(e.viewTransition, window.navigation && window.navigation.activation); });
})();
