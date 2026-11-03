// The two ways of showing the scenes: Program (an interactive mock-up of the tabs, one tab per screen
// like a photo gallery) and Story (a guided chain of scenes with an automatic camera).
import { Panel, attachGestures, tween, clamp, MAX_ZOOM, testHooks } from './stage.js'
import { Live } from './live.js'

const GAP = 14

// Index of the caption dot nearest to clientX: the whole dots cell is the target, -1 without dots.
function nearestDot(box, x) {
  let best = -1
  let bestDist = Infinity
  box.querySelectorAll('i').forEach((d, k) => {
    const r = d.getBoundingClientRect()
    const dist = Math.abs(r.left + r.width / 2 - x)
    if (dist < bestDist) { bestDist = dist; best = k }
  })
  return best
}

// --- Program ----------------------------------------------------------------------------------------
export class ProgramMode {
  constructor(app) {
    this.app = app
    this.root = document.getElementById('program')
    this.stage = this.root.querySelector('.stage')
    this.strip = this.stage.querySelector('.strip')
    this.tabbar = this.root.querySelector('.tabs')
    this.capText = this.root.querySelector('.cap-text')
    this.capDots = this.root.querySelector('.cap-left')
    this.restartBtn = this.root.querySelector('.restart')
    this.navBack = this.root.querySelector('.nav-back')
    this.navNext = this.root.querySelector('.nav-next')
    this.panels = []
    this.tabs = []
    this.state = []
    this.idx = 0
    this.offset = 0
    this.W = 0
    this.H = 0
    this.slide = null
    this.phase = 'ready' // 'ready' | 'playing'
    this.playSeq = 0 // bumped by every start or stop of a scene: an older playNext() gives up
    this.navSeq = 0 // bumped by every move to another scene or tab: an older playFrom() gives up
    this.restartBtn.addEventListener('click', () => this.restart())
    this.navBack.addEventListener('click', () => this.back())
    this.navNext.addEventListener('click', () => this.next())
    this.capDots.addEventListener('click', (e) => {
      const k = nearestDot(this.capDots, e.clientX)
      if (k >= 0) this.playFrom(this.idx, k)
    })
    new ResizeObserver(() => this.layout()).observe(this.stage)
    attachGestures(this.stage, {
      onDown: () => this.onDown(),
      onTap: (x, y) => this.onTap(x, y),
      onDoubleTap: (x, y) => this.onDoubleTap(x, y),
      onPanStart: () => this.onPanStart(),
      onPan: (g) => this.onPan(g),
      onPanEnd: (g) => this.onPanEnd(g),
      onPinchStart: () => this.onPinchStart(),
      onPinch: (g) => this.onPinch(g),
      onPinchEnd: () => this.onPinchEnd(),
      onWheel: (dy, x, y) => this.onWheel(dy, x, y),
    })
    this.live = new Live(this)
  }

  get panel() { return this.panels[this.idx] }

  // Builds the tabs from scenes.json (again after a language switch).
  build() {
    this.live?.close()
    const d = this.app.data
    this.strip.textContent = ''
    this.tabbar.textContent = ''
    for (const p of this.panels) p.unloadVideo()
    this.tabs = d.tabs
    this.panels = this.tabs.map(() => new Panel(d.frame))
    this.state = this.tabs.map(() => ({ played: 0 }))
    this.panels.forEach((p, i) => {
      p.el.dataset.tab = this.tabs[i].id
      this.strip.append(p.el)
    })
    this.tabs.forEach((t, i) => {
      const b = document.createElement('button')
      b.className = 'tab'
      b.type = 'button'
      b.dataset.tab = t.id
      b.textContent = this.app.text(t.name)
      b.addEventListener('click', () => this.go(i))
      this.tabbar.append(b)
    })
    this.idx = 0
  }

  open(i = 0) {
    this.build()
    this.idx = clamp(i, 0, this.tabs.length - 1)
    this.offset = 0
    this.phase = 'ready'
    this.layout()
    this.refresh()
  }

  close() {
    this.playSeq++
    this.navSeq++
    this.live.close()
    for (const p of this.panels) p.unloadVideo()
    this.app.clips.keep([])
  }

  layout() {
    const r = this.stage.getBoundingClientRect()
    if (!r.width || !r.height) return
    this.W = r.width
    this.H = r.height
    this.panels.forEach((p, i) => {
      p.el.style.width = `${this.W}px`
      p.el.style.height = `${this.H}px`
      p.el.style.transform = `translate3d(${i * (this.W + GAP)}px, 0, 0)`
      p.resize(this.W, this.H)
    })
    this.placeStrip()
  }

  placeStrip() {
    this.strip.style.transform = `translate3d(${-this.idx * (this.W + GAP) + this.offset}px, 0, 0)`
  }

  scenes(i) { return (this.tabs[i]?.scenes || []).map((id) => this.app.data.scenes[id]).filter(Boolean) }

  frameOf(i) {
    const sc = this.scenes(i)
    const n = this.state[i].played
    if (!sc.length) return this.app.tabStill(this.tabs[i])
    return n === 0 ? this.app.media(sc[0]).start : this.app.media(sc[n - 1]).end
  }

  nextScene(i = this.idx) {
    return this.scenes(i)[this.state[i].played] || null
  }

  // Stills of the current tab and its neighbours, marker, caption, tab bar, preloading.
  refresh() {
    this.panels.forEach((p, i) => {
      const near = Math.abs(i - this.idx) <= 1
      p.el.style.visibility = near ? 'visible' : 'hidden'
      if (!near) { p.unloadVideo(); p.showFrame(null); return }
      const busy = p.playing || (i === this.idx && this.phase === 'playing')
      if (!busy) p.showFrame(this.frameOf(i))
      const nx = this.nextScene(i)
      p.setTrigger(nx ? this.app.media(nx).trigger : null)
      p.showMarker(!!nx && !busy)
    })
    for (const b of this.tabbar.children) b.classList.toggle('on', b.dataset.tab === this.tabs[this.idx].id)
    const active = this.tabbar.children[this.idx]
    if (active && this.tabbar.scrollWidth > this.tabbar.clientWidth) {
      const left = active.offsetLeft - (this.tabbar.clientWidth - active.offsetWidth) / 2
      this.tabbar.scrollTo({ left, behavior: 'smooth' })
    }
    this.caption()
    const sc = this.scenes(this.idx)
    const n = this.state[this.idx].played
    const m = (s) => (s ? this.app.media(s).clip : null)
    this.app.clips.keep([m(sc[n]), m(sc[n + 1])], this.panels.map((p) => p.videoSrc()))
    this.app.root.dataset.tab = this.tabs[this.idx].id
    this.live.update(this.tabs[this.idx].id)
  }

  caption() {
    this.updateNav()
    if (!this.live.layer.hidden) return // the live extra keeps its own caption
    const t = this.app.t
    const i = this.idx
    const sc = this.scenes(i)
    const n = this.state[i].played
    const tab = this.tabs[i]
    let main = ''
    let hint = ''
    if (this.phase === 'playing') {
      const s = sc[n]
      main = this.app.text(s.title)
      hint = this.app.text(s.caption)
    } else if (n === 0) {
      main = this.app.text(tab.name)
      hint = sc.length ? `${t('tapPlays')}: ${this.app.text(sc[0].title)}` : ''
    } else {
      main = this.app.text(sc[n - 1].caption)
      if (sc[n]) hint = `${t('nextScene')}: ${this.app.text(sc[n].title)}`
      else if (i < this.tabs.length - 1) hint = `${t('swipeNext')}: ${this.app.text(this.tabs[i + 1].name)}`
      else hint = t('lastTab')
    }
    if (!hint && i < this.tabs.length - 1) hint = `${t('swipeNext')}: ${this.app.text(this.tabs[i + 1].name)}`
    this.app.setCaption(this.capText, main, hint)
    this.capDots.textContent = ''
    for (let k = 0; k < sc.length; k++) {
      const d = document.createElement('i')
      d.className = k < n ? 'done' : (k === n && this.phase === 'playing' ? 'now' : '')
      this.capDots.append(d)
    }
    this.restartBtn.disabled = n === 0 && this.phase !== 'playing'
  }

  // Back is off only at the program's very start, Next only after the last tab's last scene; Next pulses while
  // the mock-up waits for a touch.
  updateNav() {
    if (!this.tabs.length) return
    const i = this.idx
    const playing = this.phase === 'playing'
    this.navBack.disabled = i === 0 && this.current(i) < 0
    this.navNext.disabled = i === this.tabs.length - 1 && !playing && !this.nextScene(i)
    this.navNext.classList.toggle('wait', !playing && !this.navNext.disabled)
  }

  // Index of the scene on show in tab i: the one playing, else the last one played (-1: the tab's start).
  current(i = this.idx) {
    if (!this.state[i]) return -1
    return i === this.idx && this.phase === 'playing' ? this.state[i].played : this.state[i].played - 1
  }

  // Next: whatever plays stops at once and the following scene plays; after a tab's last scene the next tab plays
  // from its first, so the arrows alone walk the whole program.
  next() {
    const i = this.idx
    const t = this.current(i) + 1
    if (t < this.scenes(i).length) this.playFrom(i, t)
    else if (i < this.tabs.length - 1) this.playFrom(i + 1, 0)
    else if (this.phase === 'playing') { this.finishPlaying(); this.refresh() }
  }

  // Back: the scene before the one on show plays from its start; before a tab's first scene, the previous tab's
  // last one (the tab left behind goes back to its start).
  back() {
    const i = this.idx
    const c = this.current(i)
    if (c > 0) this.playFrom(i, c - 1)
    else if (i > 0) {
      this.stopPlaying()
      this.playFrom(i - 1, Math.max(0, this.scenes(i - 1).length - 1))
    } else if (c === 0) this.playFrom(i, 0, false)
  }

  // Shows tab i before its scene k (k scenes counted as played) and plays scene k (unless play is false). Acts at
  // once: a running scene stops, a tab change slides while the clip loads.
  async playFrom(i, k, play = true) {
    this.live.close()
    if (i === this.idx) this.stopPlaying()
    this.state[i].played = clamp(k, 0, this.scenes(i).length)
    if (i !== this.idx) this.go(i)
    else this.refresh()
    const seq = ++this.navSeq
    // the start still must be on before the clip starts: a still decoded later would cover the video
    await this.panels[i].showFrame(this.frameOf(i))
    if (seq !== this.navSeq || this.idx !== i) return
    if (play) this.playNext()
  }

  // Stops a running scene without counting it; the caller shows the frame that should stay.
  stopPlaying() {
    if (this.phase !== 'playing') return
    this.playSeq++
    this.panel.cancel()
    this.phase = 'ready'
  }

  // Ends a running scene at once: the scene counts as played, its end frame stays.
  finishPlaying() {
    const p = this.panel
    if (this.phase !== 'playing' || !p) return
    const sc = this.nextScene()
    this.playSeq++
    p.cancel()
    this.state[this.idx].played++
    this.phase = 'ready'
    if (sc) p.showFrame(this.app.media(sc).end)
    this.updateNav()
  }

  async playNext() {
    const i = this.idx
    const p = this.panels[i]
    const sc = this.nextScene(i)
    if (!sc || this.phase === 'playing') return
    const seq = ++this.playSeq
    const m = this.app.media(sc)
    this.phase = 'playing'
    p.showMarker(false)
    this.caption()
    let url
    try {
      url = await this.app.clips.get(m.clip)
    } catch {
      if (seq !== this.playSeq) return
      this.phase = 'ready'
      this.app.flash(this.app.t('clipError'))
      this.refresh()
      return
    }
    if (seq !== this.playSeq || this.idx !== i) return
    // the mock-up has no camera: once the picture stands still the scene is over, the marker shows at once
    const res = await p.play(url, m.end, { duration: m.duration, settle: m.settle })
    if (seq !== this.playSeq) return
    if (res === 'blocked') {
      this.phase = 'ready'
      this.app.flash(this.app.t('blocked'))
      this.refresh()
      return
    }
    if (res !== 'ended' || this.idx !== i) return
    this.state[i].played++
    this.phase = 'ready'
    this.refresh()
  }

  async restart() {
    this.live.close()
    const p = this.panel
    this.playSeq++
    this.navSeq++
    p.cancel()
    this.phase = 'ready'
    this.state[this.idx].played = 0
    await p.showFrame(this.frameOf(this.idx))
    p.animateTo({ s: 1, tx: 0, ty: 0 }, 260)
    this.refresh()
  }

  async go(i, fromSwipe = false) {
    i = clamp(i, 0, this.tabs.length - 1)
    this.navSeq++
    if (this.slide) { this.slide.cancel(); this.slide = null }
    const old = this.idx
    if (i === old) {
      this.animateOffset(0)
      return
    }
    this.finishPlaying()
    const far = Math.abs(i - old) > 1
    this.idx = i
    if (far) {
      // Jump from the tab bar: load the target first, then cut.
      this.offset = 0
      await this.panels[i].showFrame(this.frameOf(i))
      this.placeStrip()
    } else {
      // The strip moved by one panel; keep the visual position, then slide to 0.
      this.offset = fromSwipe ? this.offset + (i - old) * (this.W + GAP) : (i - old) * (this.W + GAP)
      this.placeStrip()
    }
    this.refresh()
    await this.animateOffset(0)
    if (this.idx === i) this.panels[old].resetView()
  }

  animateOffset(to) {
    const a = this.offset
    this.slide = tween(280, (u) => {
      this.offset = a + (to - a) * u
      this.placeStrip()
    })
    return this.slide.promise
  }

  // --- gestures ---
  onDown() {
    if (this.slide) { this.slide.cancel(); this.slide = null }
    this.panel?.stopAnim()
  }

  onTap(x, y) {
    const p = this.panel
    if (!p) return
    if (p.s > 1.05 && !p.hitMarker(x, y)) return
    if (this.phase === 'playing') {
      // a tap while a scene plays goes on at once to the tab's next scene (the last one jumps to its end)
      const t = this.current() + 1
      if (t < this.scenes(this.idx).length) this.playFrom(this.idx, t)
      else { this.finishPlaying(); this.refresh() }
      return
    }
    this.playNext()
  }

  onDoubleTap(x, y) {
    const p = this.panel
    if (p.s > 1.05) p.animateTo({ s: 1, tx: 0, ty: 0 }, 280)
    else p.animateTo(p.zoomAt(2.5, x, y), 280)
  }

  onPanStart() {
    const p = this.panel
    this.pan0 = { tx: p.tx, ty: p.ty, offset: this.offset }
  }

  onPan(g) {
    const p = this.panel
    if (!this.pan0) return
    let ox = g.dx
    if (p.s > 1.01) {
      const b = p.bounds(p.s)
      const tx = this.pan0.tx + g.dx
      const cx = clamp(tx, b.minX, b.maxX)
      p.set(p.s, cx, this.pan0.ty + g.dy)
      ox = tx - cx
    }
    // Rubber band past the first and the last tab.
    if ((this.idx === 0 && ox > 0) || (this.idx === this.tabs.length - 1 && ox < 0)) ox *= 0.3
    this.offset = this.pan0.offset + ox
    this.placeStrip()
  }

  onPanEnd(g) {
    this.pan0 = null
    if (g.cancelled) { this.animateOffset(0); return }
    const W = this.W
    const flick = Math.abs(g.vx) > 0.45 && Math.abs(this.offset) > 24
    if ((this.offset < -W * 0.2 || (flick && this.offset < 0)) && this.idx < this.tabs.length - 1) this.go(this.idx + 1, true)
    else if ((this.offset > W * 0.2 || (flick && this.offset > 0)) && this.idx > 0) this.go(this.idx - 1, true)
    else this.animateOffset(0)
  }

  onPinchStart() {
    const p = this.panel
    if (this.offset) this.animateOffset(0)
    this.pinch0 = { s: p.s, tx: p.tx, ty: p.ty }
  }

  onPinch(g) {
    const p = this.panel
    if (!this.pinch0) return
    const s0 = this.pinch0.s
    // Frame point that was under the first midpoint stays under the current midpoint.
    const k = p.base.k
    const fx = (g.c0.x - p.base.x - this.pinch0.tx) / (s0 * k)
    const fy = (g.c0.y - p.base.y - this.pinch0.ty) / (s0 * k)
    const s = clamp(s0 * g.ratio, 1, MAX_ZOOM)
    p.set(s, g.c.x - p.base.x - s * k * fx, g.c.y - p.base.y - s * k * fy)
  }

  onPinchEnd() {
    this.pinch0 = null
    const p = this.panel
    if (p.s < 1.05) p.animateTo({ s: 1, tx: 0, ty: 0 }, 200)
  }

  onWheel(dy, x, y) {
    const p = this.panel
    p.set(...Object.values(p.zoomAt(p.s * Math.exp(-dy * 0.0015), x, y)))
  }

  key(k) {
    if (k === 'ArrowRight') this.go(this.idx + 1)
    else if (k === 'ArrowLeft') this.go(this.idx - 1)
    else if (k === ' ' || k === 'Enter') this.playNext()
  }
}

// --- Story ------------------------------------------------------------------------------------------
const lerp = (a, b, u) => a + (b - a) * u

// The continuous show follows the work in the program (owner, 2026-11-03: by the letters it opened on the Move tab,
// showed the end card after it and jumped back to the first tab): a layer, its robot moves, the mix and the pallet,
// the files for the machine, the orders - and the end card once, after the last story. Stories not named here
// follow in their own order.
const LOOP_ORDER = ['B', 'A', 'C', 'D', 'E']
const LOOP_CARD_MS = 6000

// Camera rectangle at time t: holds each keyframe, then eases into the next one over at most 1 s,
// arriving at its time.
export function cameraAt(track, t) {
  if (!track || !track.length) return null
  if (t <= track[0].t) return track[0]
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]
    const b = track[i]
    if (t < b.t) {
      const D = Math.min(1, b.t - a.t)
      const t0 = b.t - D
      if (t <= t0) return a
      const x = (t - t0) / D
      const u = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
      const acx = a.x + a.w / 2
      const acy = a.y + a.h / 2
      const bcx = b.x + b.w / 2
      const bcy = b.y + b.h / 2
      const w = Math.exp(lerp(Math.log(a.w), Math.log(b.w), u))
      const h = Math.exp(lerp(Math.log(a.h), Math.log(b.h), u))
      const cx = lerp(acx, bcx, u)
      const cy = lerp(acy, bcy, u)
      return { x: cx - w / 2, y: cy - h / 2, w, h }
    }
  }
  return track[track.length - 1]
}

export class StoryMode {
  constructor(app) {
    this.app = app
    this.root = document.getElementById('story')
    this.stage = this.root.querySelector('.stage')
    this.capText = this.root.querySelector('.cap-text')
    this.capLeft = this.root.querySelector('.cap-left')
    this.homeBtn = this.root.querySelector('.home-corner')
    this.exitBtn = this.root.querySelector('.exit')
    this.navBack = this.root.querySelector('.nav-back')
    this.navNext = this.root.querySelector('.nav-next')
    this.card = this.root.querySelector('.endcard')
    this.panel = null
    this.story = null
    this.si = 0
    this.k = 0
    this.phase = 'idle' // 'establish' | 'intro' | 'playing' | 'ended' | 'card'
    this.loop = false
    this.auto = true
    this.cam = null
    this.token = 0
    this.raf = 0
    this.timers = []
    this.homeBtn.addEventListener('click', () => this.app.show('home'))
    this.exitBtn.addEventListener('click', () => this.app.show('home'))
    this.card.querySelector('.card-share').addEventListener('click', () => this.app.shareBrochure())
    this.card.querySelector('.card-next').addEventListener('click', () => this.openStory(this.si + 1))
    this.card.querySelector('.card-home').addEventListener('click', () => this.app.show('home'))
    this.card.querySelector('.card-replay').addEventListener('click', () => this.openStory(this.si))
    // Back / Next and the dots act at once, also while a scene plays (hidden in the hands-off modes)
    this.navBack.addEventListener('click', () => { if (!this.loop) this.back() })
    this.navNext.addEventListener('click', () => { if (!this.loop) this.next() })
    this.capLeft.addEventListener('click', (e) => {
      if (this.loop || !this.story) return
      const k = nearestDot(this.capLeft, e.clientX)
      if (k >= 0) this.runScene(k)
    })
    new ResizeObserver(() => this.layout()).observe(this.stage)
    attachGestures(this.stage, {
      onTap: (x, y) => this.onTap(x, y),
      onDoubleTap: () => this.onDoubleTap(),
      onPanStart: () => this.onPanStart(),
      onPan: (g) => this.onPan(g),
      onPanEnd: (g) => this.onPanEnd(g),
      onPinchStart: () => this.onPinchStart(),
      onPinch: (g) => this.onPinch(g),
      onPinchEnd: () => {},
      onWheel: (dy, x, y) => {
        if (this.loop) return
        this.auto = false
        const p = this.panel
        p.set(...Object.values(p.zoomAt(p.s * Math.exp(-dy * 0.0015), x, y)))
      },
    })
    // Swipe down on the end card goes home as well.
    attachGestures(this.card, {
      doubleTapDelay: 0,
      onPanEnd: (g) => { if (g.dy > 70 && g.dy > Math.abs(g.dx) * 1.3 && !this.loop) this.app.show('home') },
      onTap: () => { if (this.loop) this.showExit() },
    })
  }

  get stories() { return this.app.data.stories }

  // loop: continuous show (all stories, forever); once: one story played through without stops,
  // staying on its end card (?story=X&auto=1). Both are hands-off: no own zoom, no buttons.
  open(si, loop = false, once = false) {
    this.loop = loop || once
    this.once = once && !loop
    this.root.classList.toggle('looping', this.loop)
    this.root.classList.toggle('once', this.once)
    if (!this.panel) {
      this.panel = new Panel(this.app.data.frame)
      this.stage.append(this.panel.el)
    }
    this.layout()
    this.openStory(this.loop && !this.once ? this.loopOrder()[0] : si)
    cancelAnimationFrame(this.raf)
    let last = performance.now()
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      this.stepCamera(dt)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  close() {
    this.token++
    this.clearTimers()
    cancelAnimationFrame(this.raf)
    this.panel?.unloadVideo()
    this.panel?.showFrame(null)
    this.exitBtn.classList.remove('on')
    this.card.classList.remove('on')
    this.app.clips.keep([])
    this.phase = 'idle'
  }

  layout() {
    const r = this.stage.getBoundingClientRect()
    if (!r.width || !r.height || !this.panel) return
    this.panel.el.style.width = `${r.width}px`
    this.panel.el.style.height = `${r.height}px`
    this.panel.resize(r.width, r.height)
  }

  clearTimers() {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }

  later(ms, fn) {
    const token = this.token
    this.timers.push(setTimeout(() => { if (token === this.token) fn() }, ms))
  }

  openStory(si) {
    const n = this.stories.length
    this.si = ((si % n) + n) % n
    this.story = this.stories[this.si]
    this.app.root.dataset.story = this.story.id
    this.card.classList.remove('on')
    this.runScene(0)
  }

  sceneAt(k) { return this.app.data.scenes[this.story.scenes[k]] }

  async runScene(k) {
    const token = ++this.token
    this.clearTimers()
    this.card.classList.remove('on')
    this.k = k
    this.auto = true
    const sc = this.sceneAt(k)
    const m = this.app.media(sc)
    const p = this.panel
    p.cancel()
    this.phase = 'switching'
    this.caption()
    const ids = this.story.scenes
    const nextM = ids[k + 1] ? this.app.media(this.app.data.scenes[ids[k + 1]]) : null
    this.app.clips.keep([m.clip, nextM?.clip], [p.videoSrc()])
    // The previous scene of the same tab ended on this scene's start: glide on, no cut to full view.
    const id = this.story.scenes[k]
    const tabIds = this.app.data.tabs.find((t) => t.id === sc.tab)?.scenes || []
    const prev = this.lastEnded
    const continuous = !!prev && this.app.data.scenes[prev]?.tab === sc.tab
      && tabIds.indexOf(prev) >= 0 && tabIds.indexOf(prev) + 1 === tabIds.indexOf(id)
    this.lastEnded = null
    const sameFrame = continuous || p.stillUrl === m.start
    await p.showFrame(m.start)
    if (token !== this.token) return
    if (!sameFrame || !this.cam) {
      this.cam = { cx: p.fw / 2, cy: p.fh / 2, ls: 0 }
      this.phase = 'establish'
      this.applyCam()
      await this.sleep(450, token)
    }
    if (token !== this.token) return
    this.phase = 'intro'
    this.caption()
    let url
    try {
      ;[url] = await Promise.all([this.app.clips.get(m.clip), this.sleep(750, token)])
    } catch {
      this.app.flash(this.app.t('clipError'))
      return
    }
    if (token !== this.token) return
    this.phase = 'playing'
    this.caption()
    this.videoTime = 0
    const res = await p.play(url, m.end, { duration: m.duration, onTime: (t) => { this.videoTime = t } })
    if (res === 'blocked' && token === this.token) {
      this.phase = 'ended'
      this.caption()
      this.app.flash(this.app.t('blocked'))
      return
    }
    if (res !== 'ended' || token !== this.token) return
    this.lastEnded = id
    this.phase = 'ended'
    this.caption()
    if (this.loop) this.later(1300, () => this.next())
  }

  sleep(ms, token) {
    return new Promise((resolve) => this.timers.push(setTimeout(resolve, ms)))
      .then(() => token === this.token)
  }

  /** The indices of the stories in the continuous show's order. */
  loopOrder() {
    const ids = this.stories.map((s) => s.id)
    const order = LOOP_ORDER.map((id) => ids.indexOf(id)).filter((i) => i >= 0)
    for (let i = 0; i < ids.length; i++) if (!order.includes(i)) order.push(i)
    return order
  }

  /** The story after this one: the continuous show's order there, the letters' order elsewhere. */
  following() {
    if (!this.loop || this.once) return this.si + 1
    const order = this.loopOrder()
    return order[(order.indexOf(this.si) + 1) % order.length]
  }

  next() {
    if (this.phase === 'card') { this.openStory(this.following()); return }
    // cut short, a scene still hands its end frame on: the next one of its tab glides on from there
    if (this.phase !== 'ended') this.lastEnded = this.story.scenes[this.k]
    if (this.k < this.story.scenes.length - 1) this.runScene(this.k + 1)
    else this.showCard()
  }

  // The previous scene from its start (the first one starts again).
  back() {
    if (this.phase === 'card') { this.runScene(this.story.scenes.length - 1); return }
    this.runScene(Math.max(0, this.k - 1))
  }

  showCard() {
    const looping = this.loop && !this.once
    // the continuous show goes straight on to the next story; the card only after the last one
    if (looping) {
      const order = this.loopOrder()
      if (order.indexOf(this.si) < order.length - 1) { this.openStory(this.following()); return }
    }
    this.token++
    this.clearTimers()
    this.panel.cancel()
    this.phase = 'card'
    const n = this.stories.length
    const nextStory = this.stories[((this.following() % n) + n) % n]
    this.card.querySelector('.card-next-title').textContent = `${nextStory.id} · ${this.app.text(nextStory.title)}`
    this.card.classList.add('on')
    this.caption()
    if (looping) this.later(LOOP_CARD_MS, () => this.openStory(this.following()))
  }

  caption() {
    const t = this.app.t
    if (this.phase === 'card') {
      this.app.setCaption(this.capText, `${this.story.id} · ${this.app.text(this.story.title)}`, t('storyEnd'))
    } else {
      const sc = this.sceneAt(this.k)
      this.app.setCaption(this.capText, this.app.text(sc.title), this.app.text(sc.caption))
    }
    this.capLeft.textContent = ''
    const letter = document.createElement('b')
    letter.textContent = this.story.id
    const dots = document.createElement('span')
    dots.className = 'dots'
    const n = this.story.scenes.length
    for (let k = 0; k < n; k++) {
      const d = document.createElement('i')
      const done = this.phase === 'card' || k < this.k || (k === this.k && this.phase === 'ended')
      d.className = done ? 'done' : (k === this.k ? 'now' : '')
      dots.append(d)
    }
    this.capLeft.append(letter, dots)
    this.navNext.classList.toggle('wait', this.phase === 'ended' && !this.loop)
    this.root.dataset.phase = this.phase
    this.app.updateState()
  }

  // --- camera ---
  cameraTarget() {
    const p = this.panel
    const sc = this.sceneAt(this.k)
    if (!sc || this.phase === 'switching') return null
    const track = this.app.media(sc).camera
    let r = null
    if (this.phase === 'establish' || this.phase === 'card') r = null
    else if (this.phase === 'intro') r = track?.[0]
    else if (this.phase === 'playing') r = cameraAt(track, this.videoTime || 0)
    else if (this.phase === 'ended') r = track?.[track.length - 1]
    if (!r) return { cx: p.fw / 2, cy: p.fh / 2, ls: 0 }
    return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, ls: Math.log(p.fitScale(r, 3)) }
  }

  stepCamera(dt) {
    const p = this.panel
    if (!p || !p.W || !this.auto || !this.cam) return
    const target = this.cameraTarget()
    if (!target) return
    const tau = this.phase === 'playing' ? 0.16 : 0.3
    const a = 1 - Math.exp(-dt / tau)
    this.cam.cx += (target.cx - this.cam.cx) * a
    this.cam.cy += (target.cy - this.cam.cy) * a
    this.cam.ls += (target.ls - this.cam.ls) * a
    this.applyCam()
  }

  applyCam() {
    const p = this.panel
    const v = p.centerOn(this.cam.cx, this.cam.cy, Math.exp(this.cam.ls))
    p.set(v.s, v.tx, v.ty)
  }

  // Camera state from what the screen shows now (after own zoom), so the way back is smooth.
  camFromView() {
    const p = this.panel
    const c = p.toFrame(p.W / 2, p.H / 2)
    this.cam = { cx: c.x, cy: c.y, ls: Math.log(p.s) }
  }

  // --- gestures ---
  showExit() {
    if (this.once) return
    this.exitBtn.classList.add('on')
    clearTimeout(this.exitTimer)
    this.exitTimer = setTimeout(() => this.exitBtn.classList.remove('on'), 4000)
  }

  onTap(x) {
    if (this.loop) { this.showExit(); return }
    if (this.phase === 'card') return
    if (x > this.panel.W / 3) this.next()
    else this.back()
  }

  onDoubleTap() {
    if (this.loop) return
    if (!this.auto) { this.camFromView(); this.auto = true }
  }

  onPanStart() {
    const p = this.panel
    this.pan0 = { tx: p.tx, ty: p.ty }
  }

  onPan(g) {
    if (this.loop || !this.pan0) return
    const p = this.panel
    if (p.s > 1.01 && !this.auto) p.set(p.s, this.pan0.tx + g.dx, this.pan0.ty + g.dy)
  }

  onPanEnd(g) {
    this.pan0 = null
    if (this.loop) { this.showExit(); return }
    const p = this.panel
    const own = !this.auto && p.s > 1.01
    if (own || this.phase === 'card') return
    if (g.dy > 70 && g.dy > Math.abs(g.dx) * 1.3) this.app.show('home')
    else if (Math.abs(g.dx) > 60 && Math.abs(g.dx) > Math.abs(g.dy) * 1.3) {
      if (g.dx < 0) this.next()
      else this.back()
    }
  }

  onPinchStart() {
    if (this.loop) return
    const p = this.panel
    this.auto = false
    this.pinch0 = { s: p.s, tx: p.tx, ty: p.ty }
  }

  onPinch(g) {
    if (this.loop || !this.pinch0) return
    const p = this.panel
    const s0 = this.pinch0.s
    const k = p.base.k
    const fx = (g.c0.x - p.base.x - this.pinch0.tx) / (s0 * k)
    const fy = (g.c0.y - p.base.y - this.pinch0.ty) / (s0 * k)
    const s = clamp(s0 * g.ratio, 1, MAX_ZOOM)
    p.set(s, g.c.x - p.base.x - s * k * fx, g.c.y - p.base.y - s * k * fy)
  }

  key(k) {
    if (this.loop) return
    if (k === 'ArrowRight' || k === ' ' || k === 'Enter') this.next()
    else if (k === 'ArrowLeft') this.back()
  }
}

export { testHooks }
