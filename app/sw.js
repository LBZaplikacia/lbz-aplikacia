// Service worker: appka sa otvorí aj pri slabom signáli (uložené základné súbory).
// Pri každej novej verzii appky zvýš číslo VERZIA – zariadenia si ju stiahnu samé.
const VERZIA = "0.28.3";
const CACHE = "lbz-v" + VERZIA;
const SUPABASE = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
const SUBORY = ["./", "index.html", "styles.css", "app.js", "sklad.js", "furmanky.js", "rozpis.js", "objednavky.js", "balenie.js", "trasa.js", "dochadzka.js", "kniha.js", "vybavit.js", "zamestnanci.js", "ulohy.js", "chat.js", "lib/qr.js", "lib/dialog.js", "lib/pdfview.js", "lib/push.js", "lib/aktivita.js", "config.js", "manifest.webmanifest", "icons/logo.svg", "icons/icon-192.png", "icons/badge-96.png", "icons/monochrome-192.png", "fonts/armonioso.woff", "vybavit.html", "manifest-vybavit.webmanifest"];
self.addEventListener("install", e => {
  self.skipWaiting(); // nová verzia sa zapne hneď, nečaká na zatvorenie appky
  e.waitUntil(caches.open(CACHE).then(c => {
    c.add(SUPABASE).catch(() => {}); // knižnica prihlásenia – aby appka naštartovala aj bez signálu
    return c.addAll(SUBORY.map(u => new Request(u, { cache: "reload" })));
  }));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE && x !== "lbz-odznak").map(x => caches.delete(x)))).then(() => self.clients.claim())
));
// Najprv sieť (bez starej kópie z prehliadača), pri výpadku uložená verzia.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // knižnice z CDN majú v adrese pevnú verziu → stačí raz stiahnuť a držať v zariadení
  if (e.request.url.startsWith("https://cdn.jsdelivr.net/npm/")) {
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => {
      const kopia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopia)); return r;
    })));
    return;
  }
  if (!e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    const kopia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopia)); return r;
  }).catch(() => caches.match(e.request)));
});
// upozornenia do mobilu (web push) + číslo na ikone appky (appka ho pri otvorení nastaví presne)
async function zvysOdznak() {
  try {
    const c = await caches.open("lbz-odznak"), r = await c.match("/pocet");
    const n = (r ? +(await r.text()) || 0 : 0) + 1;
    await c.put("/pocet", new Response(String(n)));
    if (self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(n);
  } catch (x) { /* */ }
}
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "Legendárne buchty", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(Promise.all([self.registration.showNotification(d.title || "Legendárne buchty", {
    body: d.body || "", icon: "icons/icon-192.png", badge: "icons/badge-96.png", tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || "/" }, vibrate: [120, 60, 120]
  }), zvysOdznak()]));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(zoz => {
    for (const c of zoz) { if (c.url.startsWith(self.location.origin)) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
