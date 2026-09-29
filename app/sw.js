// Service worker: appka sa otvorí aj pri slabom signáli (uložené základné súbory).
// Pri každej novej verzii appky zvýš číslo VERZIA – zariadenia si ju stiahnu samé.
const VERZIA = "0.3";
const CACHE = "lbz-v" + VERZIA;
const SUBORY = ["./", "index.html", "styles.css", "app.js", "sklad.js", "config.js", "manifest.webmanifest", "icons/logo.svg"];
self.addEventListener("install", e => {
  self.skipWaiting(); // nová verzia sa zapne hneď, nečaká na zatvorenie appky
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SUBORY.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())
));
// Najprv sieť (bez starej kópie z prehliadača), pri výpadku uložená verzia.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    const kopia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopia)); return r;
  }).catch(() => caches.match(e.request)));
});
