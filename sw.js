
"use strict";

var CACHE_NAME = "mugh-shell-v1";

var APP_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(APP_FILES);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();

        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy);
        });
      }

      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) {
        return cached || caches.match("./index.html");
      });
    })
  );
});
