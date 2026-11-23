"use strict";

/* ==========================================
AGU CRYPTO ANALYZER V3.3
Updated Application Shell Cache
Owner: Umar Mohammed

SECURITY:

- Never cache external market API requests.
- Never cache private exchange credentials.
- Paper trading only.
  ========================================== */

const CACHE_NAME = "agu-crypto-shell-v33";

const APP_FILES = [
"./",
"./index.html",
"./style.css",
"./app.js",
"./manifest.webmanifest"
];

const NETWORK_FIRST_FILES = [
"index.html",
"app.js",
"style.css"
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
.filter(key =>
key.startsWith("agu-crypto-shell-") &&
key !== CACHE_NAME
)
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

// Never intercept external requests.
if (url.origin !== self.location.origin) return;

// Only handle application shell files.
const fileName = url.pathname.split("/").pop();

const isAppFile = APP_FILES.some(file => {
const fileURL = new URL(file, self.location.href);
return fileURL.pathname === url.pathname;
});

if (!isAppFile) return;

// Fresh application code first, cached copy as fallback.
const useNetworkFirst =
request.mode === "navigate" ||
NETWORK_FIRST_FILES.includes(fileName);

if (useNetworkFirst) {
event.respondWith(
fetch(request)
.then(response => {
if (response && response.ok) {
const copy = response.clone();

        caches.open(CACHE_NAME)
          .then(cache => cache.put(request, copy));
      }

      return response;
    })
    .catch(async () => {
      return (
        await caches.match(request) ||
        await caches.match("./" + fileName) ||
        await caches.match("./index.html")
      );
    })
);

return;

}

// Other application resources: cache first.
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
