// Cache-first service worker. The whole course (terrain + satellite imagery) is already
// embedded inline in index.html, so caching just the app shell + the CDN'd Three.js
// modules is enough to make the entire thing work offline after the first visit --
// useful out on the farm where connectivity can't be assumed.
const CACHE_NAME = "melasberget-diskgolf-v7";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/three@0.160.0/build/three.module.js",
  "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js",
  "https://unpkg.com/three@0.160.0/examples/jsm/environments/RoomEnvironment.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
