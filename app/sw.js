// Service worker: appka sa otvorí aj pri slabom signáli (uložené základné súbory).
const CACHE = "lbz-v0.1";
const SUBORY = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "icons/logo.svg"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SUBORY))));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))
));
// Najprv sieť, pri výpadku uložená verzia. Dáta z databázy sa necachujú.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then(r => {
    const kopia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, kopia)); return r;
  }).catch(() => caches.match(e.request)));
});
