// Service worker of the phone player. The page fills the cache itself (app.js, offlineSetup: every file
// of precache.json into the cache "pd-<version>", then the marker "__complete"); this worker answers
// from the newest complete cache, falls back to the network, and serves Range requests as 206 slices.
const PREFIX = 'pd-'
const complete = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

const scopeUrl = (p) => new URL(p, self.registration.scope).href

async function isComplete(name, cache) {
  if (complete.get(name)) return true
  const ok = !!(await cache.match(scopeUrl('__complete')))
  if (ok) complete.set(name, true)
  return ok
}

// Newest complete cache first; partial caches only as a last resort.
async function lookup(req, anyCache = false) {
  const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX)).reverse()
  const key = req.mode === 'navigate' ? scopeUrl('index.html') : req
  for (const pass of anyCache ? [true, false] : [true]) {
    for (const n of names) {
      const c = await caches.open(n)
      if (pass && !(await isComplete(n, c))) continue
      const hit = await c.match(key, { ignoreSearch: true, ignoreVary: true })
      if (hit) return hit
    }
  }
  return null
}

async function ranged(req, res) {
  const range = req.headers.get('range')
  if (!range || res.status !== 200) return res
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m) return res
  const blob = await res.blob()
  const size = blob.size
  let start
  let end
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const type = res.headers.get('Content-Type') || 'application/octet-stream'
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  })
}

async function handle(req) {
  // precache.json and the page's own downloads ask for fresh copies: network first.
  if (req.cache === 'no-store' || req.cache === 'reload') {
    try {
      return await fetch(req)
    } catch (err) {
      const hit = await lookup(req, true)
      if (hit) return ranged(req, hit)
      throw err
    }
  }
  const hit = await lookup(req)
  if (hit) return ranged(req, hit)
  try {
    return await fetch(req)
  } catch (err) {
    const any = await lookup(req, true)
    if (any) return ranged(req, any)
    throw err
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  if (new URL(req.url).origin !== self.location.origin) return
  e.respondWith(handle(req))
})
