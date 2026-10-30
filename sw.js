
"use strict";

const CACHE_NAME = "mugh-v1";

const FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(FILES)
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).then(response => {
      if (event.request.method === "GET" && response.ok) {
        const copy = response.clone();

        caches.open(CACHE_NAME).then(cache =>
          cache.put(event.request, copy)
        );
      }

      return response;

    }).catch(() =>
      caches.match(event.request).then(cached =>
        cached || caches.match("./index.html")
      )
    )
  );
});
