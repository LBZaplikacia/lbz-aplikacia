// LBZ – automatický pracovný čas podľa práce v appke (len pre osoby so zapnutým auto_cas, napr. customer service)
// Čas sa ráta, kým je appka na obrazovke a človek v nej niečo robí. Po 5 min bez dotyku/klávesnice,
// po minimalizovaní alebo zavretí appky sa rátanie zastaví. Server dostáva „ping“ každú minútu.
// Na sekundy (s108, Terézia 2. 10. 2026): pri zatvorení / prepnutí appky a po 5 min nečinnosti appka pošle presný koniec úseku.
(function () {
  "use strict";
  var DB = null, vypnute = false, posledny = Date.now(), casovac = null, kontrola = null, dnesMin = null, pohyb = 0, otvoreny = false, token = null;
  var NECINNOST = 5 * 60 * 1000;
  var zariadenie = (/Android|iPhone|iPad/.test(navigator.userAgent) ? "mobil" : "pc") + (window.matchMedia && matchMedia("(display-mode: standalone)").matches ? " appka" : " prehliadač");
  function vstup() { posledny = Date.now(); if (DB && !vypnute && !otvoreny && document.visibilityState === "visible") ping(); }
  ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "input"].forEach(function (u) { window.addEventListener(u, vstup, { passive: true, capture: true }); });
  window.addEventListener("mousemove", function () { var t = Date.now(); if (t - pohyb > 15000) { pohyb = t; vstup(); } }, { passive: true });
  function aktivny() { return document.visibilityState === "visible" && Date.now() - posledny < NECINNOST; }
  function ulozToken() { try { DB.auth.getSession().then(function (r) { token = r && r.data && r.data.session ? r.data.session.access_token : null; }); } catch (e) { /* */ } }
  function ping() {
    if (!DB || vypnute || !aktivny()) return;
    otvoreny = true;
    DB.rpc("aktivita_ping", { p_zariadenie: zariadenie }).then(function (r) {
      var d = r && r.data;
      if (d && d.vypnute) { vypnute = true; otvoreny = false; zastav(); return; }
      if (d && d.ok && d.dnes_min !== dnesMin) { dnesMin = d.dnes_min; window.dispatchEvent(new Event("lbz-aktivita")); }
    }).catch(function () { /* bez signálu – ďalší pokus o minútu */ });
    ulozToken();
  }
  // presný koniec úseku – predS = pred koľkými sekundami práca skončila
  function koniec(predS) {
    if (!DB || vypnute || !otvoreny) return;
    otvoreny = false;
    var C = window.LBZ_CONFIG || {}, telo = JSON.stringify({ p_pred_s: Math.max(0, Math.round(predS || 0)) });
    if (token && C.supabaseUrl && C.supabaseAnonKey && window.fetch) {
      try {
        fetch(C.supabaseUrl + "/rest/v1/rpc/aktivita_koniec", { method: "POST", keepalive: true,
          headers: { apikey: C.supabaseAnonKey, Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: telo }).catch(function () { /* */ });
        return;
      } catch (e) { /* */ }
    }
    DB.rpc("aktivita_koniec", { p_pred_s: Math.max(0, Math.round(predS || 0)) }).then(function () { /* */ }).catch(function () { /* */ });
  }
  function skontroluj() {   // nečinnosť 5 min → koniec presne 5 min po poslednom dotyku
    if (otvoreny && document.visibilityState === "visible" && Date.now() - posledny >= NECINNOST) koniec((Date.now() - posledny - NECINNOST) / 1000);
  }
  function zastav() { if (casovac) clearInterval(casovac); if (kontrola) clearInterval(kontrola); casovac = null; kontrola = null; }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { vstup(); ping(); }
    else koniec(0);
  });
  window.addEventListener("pagehide", function () { koniec(0); });
  window.addEventListener("focus", function () { vstup(); ping(); });
  window.lbzAktivita = {
    start: function (db) { DB = db; vypnute = false; dnesMin = null; otvoreny = false; vstup(); zastav(); ping(); casovac = setInterval(ping, 60000); kontrola = setInterval(skontroluj, 10000); },
    stop: function () { koniec(0); DB = null; dnesMin = null; zastav(); },
    dnes: function () { return vypnute ? null : dnesMin; },
    bezi: function () { return !vypnute && dnesMin !== null && aktivny(); }
  };
})();
