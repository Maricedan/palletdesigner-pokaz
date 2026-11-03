// Stage building blocks: a Panel shows one recorded frame (two stills as a double buffer plus a video
// under them) with the player's own zoom and pan, the pulsing marker of the next scene, a gesture
// recognizer on pointer events and a cache of clips as blob URLs.
//
// Coordinates: "frame" = pixels of the recorded video (scenes.json frame.width x height); "stage" = CSS
// pixels inside the panel. The layer box is the frame fitted into the panel (contain); its transform is
// translate(tx, ty) scale(s) with origin 0 0, so frame point (fx, fy) is at
// (base.x + tx + s*k*fx, base.y + ty + s*k*fy) with k = base.w / frame.width.

export const MAX_ZOOM = 4

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)
export const easeOut = (u) => 1 - Math.pow(1 - u, 3)

// Runs step(u) for u from 0 to 1 over ms; resolves true at the end, false when cancelled.
export function tween(ms, step, ease = easeOut) {
  let raf = 0
  let done
  const promise = new Promise((resolve) => { done = resolve })
  const t0 = performance.now()
  const frame = (now) => {
    const u = ms <= 0 ? 1 : clamp((now - t0) / ms, 0, 1)
    step(ease(u))
    if (u < 1) raf = requestAnimationFrame(frame)
    else done(true)
  }
  raf = requestAnimationFrame(frame)
  return { promise, cancel: () => { cancelAnimationFrame(raf); done(false) } }
}

const el = (tag, cls) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  return e
}

// Test hooks (check/phone.mjs): hold points during scene start and the last reveal geometry.
export const testHooks = {
  hold: false,
  holding: null,
  _release: null,
  lastReveal: null,
  wait(name) {
    if (!this.hold) return Promise.resolve()
    this.holding = name
    return new Promise((resolve) => {
      this._release = () => { this.holding = null; this._release = null; resolve() }
    })
  },
  release() { if (this._release) this._release() },
}

export const nextFrame = (video) => new Promise((resolve) => {
  let finished = false
  const finish = () => { if (!finished) { finished = true; resolve() } }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => finish())
  const poll = () => {
    if (finished) return
    if (video.currentTime > 0.02) finish()
    else requestAnimationFrame(poll)
  }
  requestAnimationFrame(poll)
  setTimeout(finish, 600)
})

export const once = (target, name, ms) => new Promise((resolve) => {
  const handler = () => { clearTimeout(timer); target.removeEventListener(name, handler); resolve(true) }
  const timer = ms ? setTimeout(() => { target.removeEventListener(name, handler); resolve(false) }, ms) : 0
  target.addEventListener(name, handler)
})

export class Panel {
  constructor(frame) {
    this.fw = frame.width
    this.fh = frame.height
    this.el = el('div', 'panel')
    this.layer = el('div', 'layer')
    this.video = el('video', 'clip')
    this.video.muted = true
    this.video.defaultMuted = true
    this.video.playsInline = true
    this.video.setAttribute('playsinline', '')
    this.video.setAttribute('muted', '')
    this.video.setAttribute('disablepictureinpicture', '')
    this.video.preload = 'auto'
    this.stills = [el('img', 'still'), el('img', 'still')]
    for (const s of this.stills) { s.alt = ''; s.draggable = false; s.decoding = 'async' }
    this.front = 0
    this.stillUrl = null
    this.frameSeq = 0
    this.layer.append(this.video, this.stills[0], this.stills[1])
    this.marker = el('div', 'marker')
    this.marker.append(el('div', 'ripple'), el('div', 'ring'))
    this.el.append(this.layer, this.marker)
    this.W = 0
    this.H = 0
    this.base = { x: 0, y: 0, w: 0, h: 0, k: 1 }
    this.s = 1
    this.tx = 0
    this.ty = 0
    this.trigger = null
    this.anim = null
    this.idleTimer = 0
    this.playToken = 0
    this.playing = false
  }

  resize(W, H) {
    if (!W || !H) return
    const center = this.W ? this.toFrame(this.W / 2, this.H / 2) : null
    this.W = W
    this.H = H
    const k = Math.min(W / this.fw, H / this.fh)
    const bw = this.fw * k
    const bh = this.fh * k
    this.base = { x: (W - bw) / 2, y: (H - bh) / 2, w: bw, h: bh, k }
    Object.assign(this.layer.style, {
      left: `${this.base.x}px`, top: `${this.base.y}px`, width: `${bw}px`, height: `${bh}px`,
    })
    if (center && this.s > 1) {
      this.tx = W / 2 - this.base.x - this.s * k * center.x
      this.ty = H / 2 - this.base.y - this.s * k * center.y
    }
    this.set(this.s, this.tx, this.ty)
  }

  toStage(fx, fy) {
    const m = this.s * this.base.k
    return { x: this.base.x + this.tx + m * fx, y: this.base.y + this.ty + m * fy }
  }

  toFrame(x, y) {
    const m = this.s * this.base.k
    return { x: (x - this.base.x - this.tx) / m, y: (y - this.base.y - this.ty) / m }
  }

  bounds(s) {
    const w = this.base.w * s
    const h = this.base.h * s
    const bx = w <= this.W ? [(this.W - w) / 2 - this.base.x, (this.W - w) / 2 - this.base.x]
      : [this.W - w - this.base.x, -this.base.x]
    const by = h <= this.H ? [(this.H - h) / 2 - this.base.y, (this.H - h) / 2 - this.base.y]
      : [this.H - h - this.base.y, -this.base.y]
    return { minX: bx[0], maxX: bx[1], minY: by[0], maxY: by[1] }
  }

  clampView(s, tx, ty) {
    s = clamp(s, 1, MAX_ZOOM)
    const b = this.bounds(s)
    return { s, tx: clamp(tx, b.minX, b.maxX), ty: clamp(ty, b.minY, b.maxY) }
  }

  set(s, tx, ty) {
    const v = this.clampView(s, tx, ty)
    this.s = v.s
    this.tx = v.tx
    this.ty = v.ty
    this.apply()
  }

  apply() {
    this.layer.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.s})`
    // Layer promoted only while moving: once still, the browser re-rasterizes the stills sharp.
    this.layer.style.willChange = 'transform'
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => { this.layer.style.willChange = 'auto' }, 220)
    this.placeMarker()
  }

  // View that keeps frame point under stage point (px, py) while zooming to s.
  zoomAt(s, px, py, from = null) {
    const f = from || this.toFrame(px, py)
    const k = this.base.k
    s = clamp(s, 1, MAX_ZOOM)
    return this.clampView(s, px - this.base.x - s * k * f.x, py - this.base.y - s * k * f.y)
  }

  // View centred on frame point (cx, cy) at scale s.
  centerOn(cx, cy, s) {
    const k = this.base.k
    return this.clampView(s, this.W / 2 - this.base.x - s * k * cx, this.H / 2 - this.base.y - s * k * cy)
  }

  // Scale that fits frame rect r into the stage, kept in [1, maxS].
  fitScale(r, maxS = 3) {
    const k = this.base.k
    return clamp(Math.min(this.W / (r.w * k), this.H / (r.h * k)), 1, maxS)
  }

  animateTo(v, ms = 260) {
    this.stopAnim()
    const a = { s: this.s, tx: this.tx, ty: this.ty }
    // Interpolate around the fixed point so zoom-in/out does not swing sideways.
    this.anim = tween(ms, (u) => {
      this.s = a.s + (v.s - a.s) * u
      this.tx = a.tx + (v.tx - a.tx) * u
      this.ty = a.ty + (v.ty - a.ty) * u
      this.apply()
    })
    return this.anim.promise
  }

  stopAnim() {
    if (this.anim) { this.anim.cancel(); this.anim = null }
  }

  resetView() {
    this.stopAnim()
    this.set(1, 0, 0)
  }

  // --- marker -------------------------------------------------------------------------------
  setTrigger(rect) {
    this.trigger = rect || null
    this.placeMarker()
  }

  showMarker(on) {
    this.marker.classList.toggle('on', !!on && !!this.trigger)
  }

  // Ring around the trigger on screen; the hit area is at least 12 % of the stage width.
  markerBox() {
    if (!this.trigger) return null
    const r = this.trigger
    const a = this.toStage(r.x, r.y)
    const b = this.toStage(r.x + r.w, r.y + r.h)
    const pad = 6
    const ring = { x: a.x - pad, y: a.y - pad, w: b.x - a.x + 2 * pad, h: b.y - a.y + 2 * pad }
    const minHit = Math.max(48, this.W * 0.12)
    const cx = ring.x + ring.w / 2
    const cy = ring.y + ring.h / 2
    const hw = Math.max(ring.w, minHit)
    const hh = Math.max(ring.h, minHit)
    return { ring, hit: { x: cx - hw / 2, y: cy - hh / 2, w: hw, h: hh }, cx, cy, minHit }
  }

  placeMarker() {
    const m = this.markerBox()
    if (!m) return
    Object.assign(this.marker.style, {
      left: `${m.ring.x}px`, top: `${m.ring.y}px`, width: `${m.ring.w}px`, height: `${m.ring.h}px`,
    })
    this.marker.style.setProperty('--ripple', `${m.minHit}px`)
  }

  hitMarker(x, y) {
    if (!this.marker.classList.contains('on')) return false
    const m = this.markerBox()
    if (!m) return false
    const h = m.hit
    return x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h
  }

  // --- stills and video --------------------------------------------------------------------------
  // Puts url into the hidden still, decodes it, then swaps it to the front in one step and hides
  // whatever the video showed. Resolves false when a newer call overtook this one.
  async showFrame(url) {
    const seq = ++this.frameSeq
    if (!url) {
      for (const s of this.stills) { s.classList.remove('on'); s.removeAttribute('src') }
      this.stillUrl = null
      return true
    }
    if (this.stillUrl === url && this.stills[this.front].classList.contains('on')) return true
    const back = this.stills[1 - this.front]
    if (back.getAttribute('src') !== url) back.src = url
    try { await back.decode() } catch { /* broken or missing image: show anyway */ }
    if (seq !== this.frameSeq) return false
    back.classList.add('on')
    this.stills[this.front].classList.remove('on')
    this.front = 1 - this.front
    this.stillUrl = url
    return true
  }

  // Plays clipUrl (a blob URL) over the current still, which must be the clip's first frame, and
  // ends on endUrl. opts.onTime(t) is called every frame while playing. Resolves 'ended' or
  // 'cancelled'.
  async play(clipUrl, endUrl, opts = {}) {
    const token = ++this.playToken
    const v = this.video
    const alive = () => token === this.playToken
    this.playing = true
    if (v.getAttribute('src') !== clipUrl) {
      v.src = clipUrl
      v.load()
    }
    if (v.readyState < 2) await once(v, 'loadeddata', 8000)
    if (!alive()) return 'cancelled'
    try { v.currentTime = 0 } catch { /* not seekable yet */ }
    // Decode the end frame into the hidden still now, so the swap at the end is instant.
    const back = this.stills[1 - this.front]
    if (endUrl && back.getAttribute('src') !== endUrl) back.src = endUrl
    const endReady = endUrl ? back.decode().catch(() => {}) : Promise.resolve()
    try {
      await v.play()
    } catch (e) {
      // iOS Low Power Mode refuses play() outside a user gesture.
      if (e && e.name === 'NotAllowedError') {
        this.playing = false
        return 'blocked'
      }
    }
    await nextFrame(v)
    if (!alive()) return 'cancelled'
    if (testHooks.hold) {
      v.pause()
      v.currentTime = 0
      await once(v, 'seeked', 2000)
      await testHooks.wait('before')
    }
    // Reveal: the video lies under the stills in the same box; hiding the stills shows it.
    for (const s of this.stills) s.classList.remove('on')
    const vb = v.getBoundingClientRect()
    const sb = this.stills[this.front].getBoundingClientRect()
    testHooks.lastReveal = {
      video: { x: vb.x, y: vb.y, w: vb.width, h: vb.height },
      still: { x: sb.x, y: sb.y, w: sb.width, h: sb.height },
      zoom: this.s,
    }
    if (testHooks.hold) {
      await testHooks.wait('after')
      try { await v.play() } catch { /* ignore */ }
    }
    let raf = 0
    // opts.settle: the moment the picture stands still for good (build.mjs) - the scene counts as ended there
    let settled = null
    const stillNow = new Promise((r) => { settled = r })
    const tick = () => {
      if (!alive()) return
      opts.onTime?.(v.currentTime)
      if (opts.settle && v.currentTime >= opts.settle) settled()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const limit = ((Number.isFinite(v.duration) ? v.duration : opts.duration || 10) + 2) * 1000
    await Promise.race([once(v, 'ended'), stillNow, new Promise((r) => setTimeout(r, limit)), this.cancelPromise(token)])
    if (!v.ended) v.pause()
    cancelAnimationFrame(raf)
    if (!alive()) return 'cancelled'
    opts.onTime?.(v.duration || 0)
    await endReady
    if (!alive()) return 'cancelled'
    await this.showFrame(endUrl)
    this.playing = false
    return 'ended'
  }

  cancelPromise(token) {
    return new Promise((resolve) => {
      const check = () => (token === this.playToken ? setTimeout(check, 100) : resolve())
      check()
    })
  }

  // Stops a running clip; the caller shows the frame that should stay.
  cancel() {
    this.playToken++
    this.playing = false
    try { this.video.pause() } catch { /* ignore */ }
  }

  // Frees the video (panel off screen).
  unloadVideo() {
    this.cancel()
    if (this.video.getAttribute('src')) {
      this.video.removeAttribute('src')
      this.video.load()
    }
  }

  videoSrc() { return this.video.getAttribute('src') }
}

// Clips are fetched (from the service worker's cache when offline) and played from blob URLs: iOS
// Safari does not play video from a service worker response without range support.
export class Clips {
  constructor() { this.map = new Map() }

  get(path) {
    let e = this.map.get(path)
    if (!e) {
      e = { url: null }
      e.promise = fetch(path).then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`)
        return r.blob()
      }).then((b) => {
        e.url = URL.createObjectURL(b.type ? b : new Blob([b], { type: 'video/mp4' }))
        return e.url
      })
      e.promise.catch(() => this.map.delete(path))
      this.map.set(path, e)
    }
    return e.promise
  }

  // Keeps only the given paths (and blob URLs still attached to a video element).
  keep(paths, inUseUrls = []) {
    const want = new Set(paths.filter(Boolean))
    const used = new Set(inUseUrls.filter(Boolean))
    for (const [p, e] of this.map) {
      if (want.has(p) || (e.url && used.has(e.url))) continue
      if (e.url) URL.revokeObjectURL(e.url)
      this.map.delete(p)
    }
    for (const p of want) this.get(p).catch(() => {})
  }
}

// Pointer-event gestures on one element: tap, double tap, one-finger pan, two-finger pinch.
// Handlers get stage-local coordinates.
export function attachGestures(target, h) {
  const pts = new Map()
  let mode = null // 'pending' | 'pan' | 'pinch' | 'dead'
  let start = null
  let pinch0 = null
  let samples = []
  let lastTap = null
  let tapTimer = 0
  let pendingTap = null
  const local = (e) => {
    const r = target.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const two = () => {
    const [a, b] = [...pts.values()]
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }
  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    try { target.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const p = local(e)
    pts.set(e.pointerId, p)
    h.onDown?.()
    if (pts.size === 1) {
      mode = 'pending'
      start = { x: p.x, y: p.y, t: e.timeStamp, multi: false }
      samples = [{ x: p.x, y: p.y, t: e.timeStamp }]
    } else if (pts.size === 2) {
      if (mode === 'pan') h.onPanEnd?.({ vx: 0, vy: 0, dx: 0, dy: 0, cancelled: true })
      if (start) start.multi = true
      mode = 'pinch'
      pinch0 = two()
      h.onPinchStart?.(pinch0.c)
    }
  })
  target.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return
    const p = local(e)
    pts.set(e.pointerId, p)
    if (mode === 'pending' && start && Math.hypot(p.x - start.x, p.y - start.y) > 10) {
      mode = 'pan'
      h.onPanStart?.(start)
    }
    if (mode === 'pan') {
      samples.push({ x: p.x, y: p.y, t: e.timeStamp })
      while (samples.length > 2 && e.timeStamp - samples[0].t > 120) samples.shift()
      h.onPan?.({ dx: p.x - start.x, dy: p.y - start.y, x: p.x, y: p.y })
    } else if (mode === 'pinch' && pts.size >= 2) {
      const now = two()
      h.onPinch?.({ ratio: now.d / pinch0.d, c: now.c, c0: pinch0.c })
    }
  })
  const up = (e) => {
    if (!pts.has(e.pointerId)) return
    const p = local(e)
    pts.delete(e.pointerId)
    if (mode === 'pinch') {
      if (pts.size < 2) {
        h.onPinchEnd?.()
        mode = pts.size ? 'dead' : null
      }
      return
    }
    if (pts.size) return
    if (mode === 'pan') {
      const a = samples[0]
      const dt = Math.max(1, e.timeStamp - a.t)
      h.onPanEnd?.({ vx: (p.x - a.x) / dt, vy: (p.y - a.y) / dt, dx: p.x - start.x, dy: p.y - start.y })
    } else if (mode === 'pending' && start && !start.multi && e.type !== 'pointercancel'
      && e.timeStamp - start.t < 600) {
      if (lastTap && e.timeStamp - lastTap.t < 300 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
        clearTimeout(tapTimer)
        pendingTap = null
        lastTap = null
        h.onDoubleTap?.(p.x, p.y)
      } else {
        // a tap whose timer is late (a busy phone) is not dropped by the next one: it fires now
        if (pendingTap) { clearTimeout(tapTimer); const f = pendingTap; pendingTap = null; f() }
        lastTap = { x: p.x, y: p.y, t: e.timeStamp }
        const tx = p.x
        const ty = p.y
        pendingTap = () => { lastTap = null; h.onTap?.(tx, ty) }
        tapTimer = setTimeout(() => { const f = pendingTap; pendingTap = null; f?.() }, h.doubleTapDelay ?? 300)
      }
    }
    mode = null
    start = null
  }
  target.addEventListener('pointerup', up)
  target.addEventListener('pointercancel', up)
  target.addEventListener('wheel', (e) => {
    e.preventDefault()
    const p = local(e)
    h.onWheel?.(e.deltaY, p.x, p.y)
  }, { passive: false })
}
