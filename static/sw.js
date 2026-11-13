'use strict';
// Service worker: serves the app from its cache so it works offline, and caches card images as they're viewed.
// NetrunnerDB API calls pass through untouched; the app keeps that data in IndexedDB itself.

// Change VERSION with every deploy. The new worker then caches the new files and waits; the app shows
// "New version available" and switches only when the user taps Reload.
const VERSION = '2026-11-13.5';
const SHELL = 'shell-' + VERSION;
const IMAGES = 'images';
const MAX_IMAGES = 600; // about 50 MB; the oldest are removed first
const FILES = ['./', 'app.js', 'app.css', 'manifest.webmanifest', 'icons/icons.css', 'icons/netrunner.woff',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  // The PDF library for proxy sheets (about 400 kB). The app loads it only to make a PDF, but it is precached so
  // that works offline too, with card images already kept.
  'vendor/jspdf.umd.min.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(FILES.map(async f => {
      // cache: 'reload' skips the HTTP cache, so a new version never precaches old files.
      const res = await fetch(new Request(f, { cache: 'reload' }));
      if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
      // A redirected response can't answer a page load, so keep a plain copy (some servers redirect, e.g. to add a /).
      await cache.put(f, res.redirected ? new Response(await res.blob(), { headers: res.headers }) : res);
    }));
  })());
});

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin === location.origin) e.respondWith(fromShell(req));
  else if (url.hostname === 'card-images.netrunnerdb.com') e.respondWith(image(e));
});

async function fromShell(req) {
  const cache = await caches.open(SHELL);
  // Any page in scope is the app (routes live in the hash), whatever its query string.
  const hit = req.mode === 'navigate' ? await cache.match('./') : await cache.match(req);
  return hit || fetch(req);
}

// Cache-first. Offline, an image never seen fails, and the app shows the card title in its place.
async function image(e) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(e.request, { ignoreVary: true });
  if (hit) return hit;
  let res;
  try { res = await fetch(e.request); } catch { return Response.error(); }
  // Only real (CORS) responses: an opaque one counts as several MB against the storage quota.
  if (res.ok && res.type === 'cors') e.waitUntil(cache.put(e.request, res.clone()).then(() => trim(cache)));
  return res;
}

// cache.keys() lists entries in the order they were added, so the first ones are the oldest.
async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(k);
}
