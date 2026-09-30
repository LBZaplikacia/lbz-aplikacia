// LBZ – automatický pracovný čas podľa práce v appke (len pre osoby so zapnutým auto_cas, napr. customer service)
// Čas sa ráta, kým je appka na obrazovke a človek v nej niečo robí. Po 5 min bez dotyku/klávesnice,
// po minimalizovaní alebo zavretí appky sa rátanie zastaví. Server dostáva „ping“ každú minútu.
(function () {
  "use strict";
  var DB = null, vypnute = false, posledny = Date.now(), casovac = null, dnesMin = null, pohyb = 0;
  var NECINNOST = 5 * 60 * 1000;
  var zariadenie = (/Android|iPhone|iPad/.test(navigator.userAgent) ? "mobil" : "pc") + (window.matchMedia && matchMedia("(display-mode: standalone)").matches ? " appka" : " prehliadač");
  function vstup() { posledny = Date.now(); }
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "input"].forEach(function (u) { window.addEventListener(u, vstup, { passive: true, capture: true }); });
  window.addEventListener("mousemove", function () { var t = Date.now(); if (t - pohyb > 15000) { pohyb = t; vstup(); } }, { passive: true });
  function aktivny() { return document.visibilityState === "visible" && Date.now() - posledny < NECINNOST; }
  function ping() {
    if (!DB || vypnute || !aktivny()) return;
    DB.rpc("aktivita_ping", { p_zariadenie: zariadenie }).then(function (r) {
      var d = r && r.data;
      if (d && d.vypnute) { vypnute = true; zastav(); return; }
      if (d && d.ok && d.dnes_min !== dnesMin) { dnesMin = d.dnes_min; window.dispatchEvent(new Event("lbz-aktivita")); }
    }).catch(function () { /* bez signálu – ďalší pokus o minútu */ });
  }
  function zastav() { if (casovac) clearInterval(casovac); casovac = null; }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { vstup(); ping(); } });
  window.addEventListener("focus", function () { vstup(); ping(); });
  window.lbzAktivita = {
    start: function (db) { DB = db; vypnute = false; dnesMin = null; vstup(); zastav(); ping(); casovac = setInterval(ping, 60000); },
    stop: function () { DB = null; dnesMin = null; zastav(); },
    dnes: function () { return vypnute ? null : dnesMin; },
    bezi: function () { return !vypnute && dnesMin !== null && aktivny(); }
  };
})();
