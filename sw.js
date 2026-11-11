// Service worker: permite instalar la app y usarla sin internet.
// Estrategia "primero la red": si hay internet, siempre trae lo más nuevo;
// si no hay, usa la última copia guardada.
const CACHE = "closet-v1";
const BASICOS = ["./", "index.html", "styles.css", "app.js", "prendas.json", "manifest.json", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // el clima no se cachea aquí
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
