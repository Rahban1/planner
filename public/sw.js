/* Planner service worker */
const CACHE_VERSION = 'planner-v1'
const STATIC_CACHE = `${CACHE_VERSION}-static`

// App shell assets (hashed by Vite, safe to cache aggressively).
const PRECACHE = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/logo.svg',
  '/logo192.png',
  '/logo512.png',
  '/logo-maskable.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('planner-v') && key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only handle GET requests on our own origin.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never intercept the Access auth endpoints — they must hit the network.
  if (url.pathname.startsWith('/cdn-cgi/')) return

  // Hashed build assets (JS/CSS/images/fonts) -> cache-first.
  if (/\/assets\//.test(url.pathname) || /\.(png|jpe?g|svg|ico|woff2?|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Refresh the cache in the background.
          fetch(request).then((fresh) => {
            if (fresh && fresh.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, fresh))
          })
          return cached
        }
        return fetch(request).then((fresh) => {
          if (fresh && fresh.ok) {
            const copy = fresh.clone()
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
          }
          return fresh
        })
      }),
    )
    return
  }

  // HTML navigations / API -> network-first, fall back to cached shell so the
  // app still opens offline (data will be stale but the UI renders).
  event.respondWith(
    fetch(request)
      .then((fresh) => {
        if (fresh && fresh.ok && url.pathname === '/') {
          const copy = fresh.clone()
          caches.open(STATIC_CACHE).then((cache) => cache.put('/', copy))
        }
        return fresh
      })
      .catch(async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          return caches.match('/')
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' })
      }),
  )
})
