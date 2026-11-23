"use strict";

/* ==========================================
   AGU CRYPTO ANALYZER V3.2
   Safe Application Shell Cache
========================================== */

const CACHE_NAME = "agu-crypto-shell-v33";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.webmanifest"
];

/* INSTALL */

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

/* ACTIVATE */

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* FETCH */

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache Binance or other external market API requests.
  if (url.origin !== self.location.origin) return;

  // Navigation: try the network first, then the cached app page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache only known application shell files.
  const isAppFile = APP_FILES.some(file => {
    const fileURL = new URL(file, self.location.href);
    return fileURL.pathname === url.pathname;
  });

  if (!isAppFile) return;

  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) return cached;

        return fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, copy));
          }

          return response;
        });
      })
  );
});
