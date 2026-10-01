// Wars Service Worker v2 — cache-safety hardened (Oct 1).
// FIX: v1 was cache-first for NAVIGATIONS → stale HTML referencing renamed
// build chunks (new deploy = new chunk hashes) → half-rendered/white pages.
// v2 policy:
//   - Navigations (HTML): NETWORK-FIRST with cache fallback (fresh pages, offline safety).
//   - Immutable build chunks (/wars-app/_next/static/) + images/fonts: CACHE-FIRST
//     (they are content-hashed or versioned; safe to pin).
//   - New cache name forces immediate purge of all v1 state on activation.
// Base-path aware: works at site root (standalone) AND under /wars-app/ (GitHub Pages).

const BASE = new URL(self.registration.scope).pathname;
const CACHE = "wars-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.allSettled(
          [`${BASE}`, `${BASE}manifest.webmanifest`, `${BASE}icons/icon-192.svg`].map(
            (u) => cache.add(u),
          ),
        ),
      ),
  );
  // Take over instantly so users never run the old worker again.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge EVERY cache except v2 — old shells must die here.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  const url = new URL(request.url);
  const isNav = request.mode === "navigate";
  // Immutable, content-hashed build output → safe to pin forever.
  const isImmutable =
    url.pathname.includes("/_next/static/") ||
    /\.(?:png|jpg|jpeg|svg|woff2?)$/.test(url.pathname);

  if (isNav) {
    // NETWORK-FIRST: always try fresh HTML; fall back to cache when offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches
              .open(CACHE)
              .then((c) => c.put(request, clone))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(request, { ignoreSearch: true }).then(
            (cached) =>
              cached ||
              caches.match(`${BASE}`).then((root) => root || Response.error()),
          ),
        ),
    );
    return;
  }

  if (isImmutable) {
    // CACHE-FIRST for hashed assets: instant loads, never half-stale.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches
                .open(CACHE)
                .then((c) => c.put(request, clone))
                .catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else (sw, docs, json): plain network passthrough.
});