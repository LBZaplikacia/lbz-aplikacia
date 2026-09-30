// LBZ – upozornenia do mobilu (web push) a číslo na ikone appky (odznak)
// lbzPush.stav() → "zapnute" | "vypnute" | "zakazane" | "nepodporuje"
// lbzPush.zapni(db) → prihlási toto zariadenie na upozornenia (Promise s textom)
// lbzPush.odznak(n) → nastaví číslo na ikone appky (0 = zmaže)
(function () {
  "use strict";
  function moze() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function b64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  // service worker – nečakať donekonečna (na iPhone sa ready nemusí nikdy splniť, ak inštalácia zlyhala)
  function pripraveny() {
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (ok) { setTimeout(function () { ok(null); }, 4000); })
    ]).then(function (r) {
      if (r) return r;
      return navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(function () {
        return Promise.race([navigator.serviceWorker.ready, new Promise(function (ok) { setTimeout(function () { ok(null); }, 8000); })]);
      }).catch(function () { return null; });
    });
  }
  function stav() {
    if (!moze()) return Promise.resolve("nepodporuje");
    if (Notification.permission === "denied") return Promise.resolve("zakazane");
    return pripraveny().then(function (r) { return r ? r.pushManager.getSubscription() : null; })
      .then(function (s) { return s && Notification.permission === "granted" ? "zapnute" : "vypnute"; }).catch(function () { return "vypnute"; });
  }
  function zapni(db) {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") throw new Error("Upozornenia nie sú povolené – povoľ ich v nastaveniach telefónu pre túto appku.");
      return db.functions.invoke("upozornenia", { body: { akcia: "kluc" } });
    }).then(function (k) {
      var kl = k && k.data && k.data.kluc; if (!kl) throw new Error("Upozornenia ešte nie sú nastavené na serveri");
      return pripraveny().then(function (r) {
        if (!r) throw new Error("Appka sa ešte nenainštalovala – zavri ju úplne, otvor znova z ikony a skús to ešte raz.");
        return r.pushManager.getSubscription().then(function (s) { return s || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(kl) }); });
      });
    }).then(function (sub) {
      var j = sub.toJSON(); j.zariadenie = navigator.userAgent;
      return db.rpc("push_uloz", { p: j });
    }).then(function (r) {
      if (r && r.error) throw r.error;
      db.functions.invoke("upozornenia", { body: { akcia: "test" } }).catch(function () { /* */ });
      return "🔔 Upozornenia sú zapnuté – o chvíľu príde skúšobné.";
    });
  }
  // aj keď je odber v poriadku, pri každom prihlásení ho uložíme k aktuálnemu účtu (zmena účtu na tom istom telefóne)
  function obnov(db) {
    if (!moze() || Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) {
      if (!s) return; var j = s.toJSON(); j.zariadenie = navigator.userAgent; return db.rpc("push_uloz", { p: j });
    }).catch(function () { /* */ });
  }
  function odznak(n) {
    n = Math.max(0, +n || 0);
    try { if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); } } catch (e) { /* */ }
    try { if (window.caches) caches.open("lbz-odznak").then(function (c) { return c.put("/pocet", new Response(String(n))); }).catch(function () { /* */ }); } catch (e) { /* */ }
  }
  // zatvorí upozornenia v lište telefónu (začiatok značky, napr. "chat-12-" alebo "chat-"); podľa nich Android ukazuje číslo na ikone
  function zavri(zaciatok) {
    try {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.ready.then(function (r) { return r.getNotifications(); })
        .then(function (z) { (z || []).forEach(function (n) { if (!zaciatok || String(n.tag || "").indexOf(zaciatok) === 0) n.close(); }); }).catch(function () { /* */ });
    } catch (e) { /* */ }
  }
  window.lbzPush = { moze: moze, stav: stav, zapni: zapni, obnov: obnov, odznak: odznak, zavri: zavri };
})();
