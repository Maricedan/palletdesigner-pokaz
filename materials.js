// The presentation and materials: the marketing deck's slides and the animations (media/materials/materials.json, made
// by tools/phone-demo/materials.mjs), one item per screen like the mock-up's tabs. Swipe or Back / Next between them,
// two fingers or a double tap zoom, the tab bar jumps to the deck, the data-flow map and the animations. An animation
// plays in place when it comes on screen and loops; a tap pauses it and goes on. Language: the player's, with the
// Polish file where an item has no other.
import { Panel, attachGestures, tween, clamp, MAX_ZOOM, nextFrame, once } from './stage.js'

const GAP = 14
const ROOT = 'media/materials/'

export class MaterialsMode {
  constructor(app) {
    this.app = app
    this.root = document.getElementById('materials')
    this.stage = this.root.querySelector('.stage')
    this.strip = this.stage.querySelector('.strip')
    this.tabbar = this.root.querySelector('.tabs')
    this.count = this.root.querySelector('.count')
    this.playHint = this.root.querySelector('.play-hint')
    this.navBack = this.root.querySelector('.nav-back')
    this.navNext = this.root.querySelector('.nav-next')
    this.items = []
    this.panels = []
    this.tabs = []
    this.idx = 0
    this.offset = 0
    this.W = 0
    this.H = 0
    this.slide = null
    this.playing = -1 // item whose animation is started (it may be paused)
    this.paused = false
    this.playSeq = 0
    this.navSeq = 0
    this.navBack.addEventListener('click', () => this.go(this.idx - 1))
    this.navNext.addEventListener('click', () => this.go(this.idx + 1))
    this.root.querySelector('.home-btn').addEventListener('click', () => this.app.show('home'))
    new ResizeObserver(() => this.layout()).observe(this.stage)
    attachGestures(this.stage, {
      onDown: () => this.onDown(),
      onTap: () => this.onTap(),
      onDoubleTap: (x, y) => this.onDoubleTap(x, y),
      onPanStart: () => this.onPanStart(),
      onPan: (g) => this.onPan(g),
      onPanEnd: (g) => this.onPanEnd(g),
      onPinchStart: () => this.onPinchStart(),
      onPinch: (g) => this.onPinch(g),
      onPinchEnd: () => this.onPinchEnd(),
      onWheel: (dy, x, y) => this.onWheel(dy, x, y),
    })
  }

  get panel() { return this.panels[this.idx] }
  get item() { return this.items[this.idx] }

  // A path of the manifest (string or { pl, en }) in the shown language, under media/materials/.
  file(v) {
    const p = typeof v === 'string' ? v : (v?.[this.app.lang] || v?.pl)
    return p ? ROOT + p : null
  }

  // What stands on an item's panel while nothing plays: the slide, or the animation's first frame.
  stillOf(i) {
    const it = this.items[i]
    return it.kind === 'video' ? this.file(it.poster) : this.file(it.file)
  }

  // The tabs: every group from its first item, and the data-flow map (the first item tagged so) after its group.
  build() {
    const d = this.app.mat
    for (const p of this.panels) p.unloadVideo()
    this.strip.textContent = ''
    this.tabbar.textContent = ''
    this.items = d.items
    this.panels = this.items.map((it) => new Panel({ width: it.width, height: it.height }))
    this.panels.forEach((p, i) => {
      p.el.dataset.item = this.items[i].id
      this.strip.append(p.el)
    })
    const flow = this.items.findIndex((it) => it.tag === 'data-flow')
    this.flow = flow
    this.tabs = []
    for (const g of d.groups || []) {
      const i = this.items.findIndex((it) => it.group === g.id)
      if (i < 0) continue
      this.tabs.push({ id: g.id, name: this.app.text(g.title), i })
      if (flow >= 0 && this.items[flow].group === g.id) this.tabs.push({ id: 'data-flow', name: this.app.t('dataFlow'), i: flow })
    }
    for (const t of this.tabs) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tab'
      b.dataset.tab = t.id
      b.textContent = t.name
      b.addEventListener('click', () => this.go(t.i))
      this.tabbar.append(b)
    }
  }

  tabOf(i) {
    return i === this.flow ? 'data-flow' : this.items[i].group
  }

  open(i = 0) {
    this.build()
    this.idx = clamp(i, 0, this.items.length - 1)
    this.offset = 0
    this.playing = -1
    this.layout()
    this.refresh()
    this.autoplay()
  }

  close() {
    this.stopVideo()
    this.navSeq++
    if (this.slide) { this.slide.cancel(); this.slide = null }
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

  // The item on show and its neighbours get their pictures, the others none; the animations of those three are kept.
  refresh() {
    this.panels.forEach((p, i) => {
      const near = Math.abs(i - this.idx) <= 1
      p.el.style.visibility = near ? 'visible' : 'hidden'
      if (!near) { p.unloadVideo(); p.showFrame(null); return }
      if (i !== this.playing) p.showFrame(this.stillOf(i))
    })
    const tab = this.tabOf(this.idx)
    for (const b of this.tabbar.children) b.classList.toggle('on', b.dataset.tab === tab)
    const active = [...this.tabbar.children].find((b) => b.dataset.tab === tab)
    if (active && this.tabbar.scrollWidth > this.tabbar.clientWidth) {
      const left = active.offsetLeft - (this.tabbar.clientWidth - active.offsetWidth) / 2
      this.tabbar.scrollTo({ left, behavior: 'smooth' })
    }
    this.count.textContent = `${this.idx + 1} / ${this.items.length}`
    this.navBack.disabled = this.idx === 0
    this.navNext.disabled = this.idx === this.items.length - 1
    const videos = this.items.map((it, i) => (it.kind === 'video' && Math.abs(i - this.idx) <= 1 ? this.file(it.file) : null))
    this.app.clips.keep(videos, this.panels.map((p) => p.videoSrc()))
    this.app.root.dataset.item = this.item.id
    this.renderPlay()
  }

  // The play sign over a paused or not yet started animation (on top of the picture: nothing moves).
  renderPlay() {
    const it = this.item
    this.playHint.classList.toggle('on', !!it && it.kind === 'video' && (this.playing !== this.idx || this.paused))
  }

  async go(i, fromSwipe = false) {
    i = clamp(i, 0, this.items.length - 1)
    this.navSeq++
    if (this.slide) { this.slide.cancel(); this.slide = null }
    const old = this.idx
    if (i === old) {
      this.animateOffset(0)
      return
    }
    const seq = this.navSeq
    this.stopVideo()
    this.idx = i
    if (Math.abs(i - old) > 1) {
      // a jump from the tab bar: the target's picture first, then the cut
      this.offset = 0
      await this.panels[i].showFrame(this.stillOf(i))
      if (seq !== this.navSeq) return
      this.placeStrip()
    } else {
      // the strip moved by one panel: keep the visual position, then slide to 0
      this.offset = fromSwipe ? this.offset + (i - old) * (this.W + GAP) : (i - old) * (this.W + GAP)
      this.placeStrip()
    }
    this.refresh()
    await this.animateOffset(0)
    if (seq !== this.navSeq) return
    this.panels[old]?.resetView()
    this.autoplay()
  }

  animateOffset(to) {
    const a = this.offset
    this.slide = tween(280, (u) => {
      this.offset = a + (to - a) * u
      this.placeStrip()
    })
    return this.slide.promise
  }

  // --- animations ---
  autoplay() {
    if (this.item?.kind === 'video') this.playVideo()
  }

  // Plays the shown animation from its start over its first frame (the still on show), looping.
  async playVideo() {
    const i = this.idx
    const it = this.items[i]
    const p = this.panels[i]
    const seq = ++this.playSeq
    this.playing = i
    this.paused = false
    this.renderPlay()
    const fail = (msg) => {
      if (seq !== this.playSeq) return
      this.playing = -1
      this.renderPlay()
      this.app.flash(msg)
    }
    let url
    try {
      url = await this.app.clips.get(this.file(it.file))
    } catch {
      fail(this.app.t('clipError'))
      return
    }
    if (seq !== this.playSeq) return
    const v = p.video
    v.loop = true
    if (v.getAttribute('src') !== url) {
      v.src = url
      v.load()
    }
    if (v.readyState < 2) await once(v, 'loadeddata', 8000)
    if (seq !== this.playSeq) return
    try { v.currentTime = 0 } catch { /* not seekable yet */ }
    // the poster must be on before the video shows through it
    await p.showFrame(this.stillOf(i))
    if (seq !== this.playSeq) return
    try {
      await v.play()
    } catch (e) {
      // iOS Low Power Mode refuses play() outside a user gesture
      if (e && e.name === 'NotAllowedError') { fail(this.app.t('blocked')); return }
    }
    await nextFrame(v)
    if (seq !== this.playSeq) return
    // the video lies under the stills in the same box: hiding them shows it
    for (const s of p.stills) s.classList.remove('on')
  }

  // Stops the animation that plays and puts its first frame back.
  stopVideo() {
    this.playSeq++
    const i = this.playing
    this.playing = -1
    this.paused = false
    if (i < 0 || !this.panels[i]) return
    const p = this.panels[i]
    try { p.video.pause() } catch { /* ignore */ }
    p.showFrame(this.stillOf(i))
  }

  togglePause() {
    if (this.item?.kind !== 'video') return
    if (this.playing !== this.idx) { this.playVideo(); return }
    const v = this.panel.video
    if (this.paused) {
      this.paused = false
      v.play().catch(() => {})
    } else {
      this.paused = true
      v.pause()
    }
    this.renderPlay()
  }

  // --- gestures (as in the mock-up) ---
  onDown() {
    if (this.slide) { this.slide.cancel(); this.slide = null }
    this.panel?.stopAnim()
  }

  // a tap pauses or goes on with the animation; a tap that stopped a slide between items lets it land
  onTap() {
    if (this.offset) this.animateOffset(0)
    this.togglePause()
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
    // rubber band past the first and the last item
    if ((this.idx === 0 && ox > 0) || (this.idx === this.items.length - 1 && ox < 0)) ox *= 0.3
    this.offset = this.pan0.offset + ox
    this.placeStrip()
  }

  onPanEnd(g) {
    this.pan0 = null
    if (g.cancelled) { this.animateOffset(0); return }
    const W = this.W
    const flick = Math.abs(g.vx) > 0.45 && Math.abs(this.offset) > 24
    if ((this.offset < -W * 0.2 || (flick && this.offset < 0)) && this.idx < this.items.length - 1) this.go(this.idx + 1, true)
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
    // the picture's point that was under the first midpoint stays under the current one
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
    else if (k === ' ' || k === 'Enter') this.togglePause()
  }
}
