// Live placing drawing of the phone player: the placing of the examples (recordings/extras/placing.json,
// made by record/extras-data.mjs) drawn from above the way the program's Move tab draws it
// (web/src/tabs/move/, web/src/components/canvas/: colours, label bars, orientation dots, gripper),
// with the placings played one after another and a slider to scrub them with a finger.
//
//   mount(host, data, { lang, autoplay = true }) -> { destroy(), setLang(lang) }
//
// The drawing: a tap plays / pauses, a sideways drag steps through the placings. Below it, in a bar of
// fixed height: the play button, the label "Odłożenie 7 / 16 · kartony: 3" and the slider. Touches that
// start in the left or right edge strip of the drawing go on to the player (its tab swipe); the bar
// keeps all its touches.
import { ensureStyles, guardGestures, pick, pixelRatio } from './common.js'

const STEP_MS = 700
const END_PAUSE_MS = 1600
const DROP_MS = 260
const SCRUB_PX = 28 // a sideways drag on the drawing: one placing per this many pixels

const COLORS = {
  background: '#f7fafd',
  palletFill: '#ebf0f6',
  palletStroke: '#c3d0e0',
  boxStroke: 'rgba(16,27,45,0.35)',
  ink: '#101b2d',
  labelBar: '#00b4c8',
  labelBarStroke: '#007891',
  placed: '#4caf50',
  selected: '#2196f3',
  unplaced: 'rgba(189,189,189,0.5)',
  gripper: '#ff8c00',
}

const TEXT = {
  pl: {
    placing: 'Odłożenie',
    cartons: 'kartony:',
    play: 'Odtwórz',
    pause: 'Pauza',
    slider: 'Numer odłożenia',
    legend: { placed: 'odłożony', selected: 'wybrany', unplaced: 'jeszcze nie odłożony', gripper: 'chwytak' },
  },
  en: {
    placing: 'Placing',
    cartons: 'cartons:',
    play: 'Play',
    pause: 'Pause',
    slider: 'Placing number',
    legend: { placed: 'placed', selected: 'selected', unplaced: 'not placed yet', gripper: 'gripper' },
  },
}

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="4.5" width="4.5" height="15" rx="1" fill="currentColor"/><rect x="14" y="4.5" width="4.5" height="15" rx="1" fill="currentColor"/></svg>'

const PALLET_PICTURES = [{ width: 800, length: 1200, file: './pallet-euro.png' }]

// ---- what is drawn on a box, in mm from its top-left corner (web/src/components/canvas/boxGeometry.ts)
function rotatedLabelSides(sides, orientation) {
  switch (orientation) {
    case 3: return { 1: sides['7'], 3: sides['1'], 5: sides['3'], 7: sides['5'] }
    case 5: return { 1: sides['5'], 3: sides['7'], 5: sides['1'], 7: sides['3'] }
    case 7: return { 1: sides['3'], 3: sides['5'], 5: sides['7'], 7: sides['1'] }
    default: return { 1: sides['1'], 3: sides['3'], 5: sides['5'], 7: sides['7'] }
  }
}
function labelRects(w, h, sides, orientation) {
  if (w < 12 || h < 12) return []
  const shown = rotatedLabelSides(sides, orientation)
  const across = Math.max(w / 3, 8)
  const down = Math.max(h / 3, 8)
  const rects = []
  if (shown['1']) rects.push([w / 2 - across / 2, 2, across, 10])
  if (shown['3']) rects.push([w - 12, h / 2 - down / 2, 10, down])
  if (shown['5']) rects.push([w / 2 - across / 2, h - 12, across, 10])
  if (shown['7']) rects.push([2, h / 2 - down / 2, 10, down])
  return rects
}
function dotOf(w, h, orientation) {
  const min = Math.min(w, h)
  const size = Math.max(2, min < 10 ? min / 3 : Math.min(16, min / 4))
  const pad = Math.max(1, size / 3)
  const right = orientation === 3 || orientation === 5
  const bottom = orientation === 5 || orientation === 7
  return [right ? w - size - pad : pad, bottom ? h - size - pad : pad, size]
}
/** QColor.darker(percent) for #rrggbb; other forms unchanged. */
function darker(color, percent) {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  return '#' + [0, 2, 4].map((i) => Math.min(255, Math.round((parseInt(m[1].slice(i, i + 2), 16) * 100) / percent)).toString(16).padStart(2, '0')).join('')
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const easeOut = (t) => 1 - (1 - t) ** 3

export function mount(host, data, { lang = 'pl', autoplay = true } = {}) {
  ensureStyles(host.ownerDocument)
  let texts = pick(lang, TEXT)
  const placings = data.placings
  const N = placings.length
  const pallet = data.pallet
  const labelSides = data.box?.labelSides ?? {}
  const typeColor = (t) => (t != null && data.types?.[String(t)]?.color) || COLORS.placed
  // the placing that puts each box down (1-based)
  const placingOf = new Map()
  placings.forEach((p, i) => p.boxes.forEach((b) => placingOf.set(b.id, i + 1)))
  const boxes = data.boxes?.length ? data.boxes : placings.flatMap((p) => p.boxes)

  // ---- elements
  const root = document.createElement('div')
  root.className = 'pdx-root pdx-placing'
  const viewEl = document.createElement('div')
  viewEl.className = 'pdx-view'
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-label', data.name)
  const legend = document.createElement('div')
  legend.className = 'pdx-chip pdx-legend'
  legend.style.cssText = 'left:10px;top:10px;max-width:calc(100% - 20px);font-size:12px;line-height:16px;gap:4px 10px'
  viewEl.append(canvas, legend)

  const controls = document.createElement('div')
  controls.className = 'pdx-controls wide'
  const play = document.createElement('button')
  play.type = 'button'
  play.className = 'pdx-play'
  const label = document.createElement('div')
  label.className = 'pdx-label'
  // the numbers stand in boxes of the widest value: the label never changes width
  const num = (digits) => {
    const s = document.createElement('span')
    s.className = 'num'
    s.style.width = `${digits}ch`
    return s
  }
  const lPlacing = document.createElement('span')
  const lCur = num(String(N).length)
  const lOf = document.createElement('span')
  lOf.className = 'of'
  const lSep = document.createElement('span')
  lSep.className = 'sep'
  lSep.textContent = '·'
  const lCartons = document.createElement('span')
  const lCount = num(String(Math.max(1, ...placings.map((p) => p.boxes.length))).length)
  label.append(lPlacing, ' ', lCur, lOf, lSep, lCartons, ' ', lCount)

  const slider = document.createElement('div')
  slider.className = 'pdx-slider'
  slider.tabIndex = 0
  slider.setAttribute('role', 'slider')
  slider.setAttribute('aria-valuemin', '0')
  slider.setAttribute('aria-valuemax', String(N))
  const track = document.createElement('div')
  track.className = 'pdx-track'
  const fill = document.createElement('div')
  fill.className = 'pdx-fill'
  track.appendChild(fill)
  const ticks = []
  for (let k = 0; k <= N; k++) {
    const t = document.createElement('i')
    t.className = 'pdx-tick'
    t.style.left = `${(k / N) * 100}%`
    track.appendChild(t)
    ticks.push(t)
  }
  const thumb = document.createElement('div')
  thumb.className = 'pdx-thumb'
  slider.append(track, thumb)
  controls.append(play, label, slider)
  root.append(viewEl, controls)
  host.appendChild(root)

  const legendItem = (swatch, text) => {
    const s = document.createElement('span')
    const i = document.createElement('i')
    i.className = 'sw'
    i.style.cssText = swatch
    s.append(i, document.createTextNode(text))
    return s
  }
  const applyTexts = () => {
    lPlacing.textContent = texts.placing
    lOf.textContent = ` / ${N}`
    lCartons.textContent = texts.cartons
    slider.setAttribute('aria-label', texts.slider)
    legend.replaceChildren(
      legendItem(`background:${COLORS.placed}`, texts.legend.placed),
      legendItem(`background:${COLORS.selected}`, texts.legend.selected),
      legendItem('background:#e3e3e3', texts.legend.unplaced),
      legendItem(`background:rgba(255,140,0,.31);box-shadow:inset 0 0 0 2px ${COLORS.gripper}`, texts.legend.gripper),
    )
    showPlaying()
  }

  // ---- state
  let cur = 0
  let playing = false
  let timer = 0
  let drop = null // { start, from: gripper rect or null }
  let frame = 0
  let disposed = false
  let picture = null
  const pic = PALLET_PICTURES.find((p) => p.width === pallet.width && p.length === pallet.length)
  if (pic) {
    const img = new Image()
    img.onload = () => {
      if (disposed) return
      picture = img
      draw()
    }
    img.src = new URL(pic.file, import.meta.url).href
  }

  // ---- the drawing
  let cssW = 0
  let cssH = 0
  let ratio = 1
  let fit = { s: 1, ox: 0, oy: 0 }
  // what the view frames: the pallet and the grippers, but never more than 30 % beside the pallet
  // and 22 % above and below it (a phone held sideways has little height)
  const bounds = (() => {
    let [x0, y0, x1, y1] = [0, 0, pallet.width, pallet.length]
    for (const p of placings) {
      const [gx, gy, gw, gh] = p.gripper
      x0 = Math.min(x0, gx)
      y0 = Math.min(y0, gy)
      x1 = Math.max(x1, gx + gw)
      y1 = Math.max(y1, gy + gh)
    }
    const mx = pallet.width * 0.3
    const my = pallet.length * 0.22
    return [Math.max(x0, -mx), Math.max(y0, -my), Math.min(x1, pallet.width + mx), Math.min(y1, pallet.length + my)]
  })()
  const layout = () => {
    const [x0, y0, x1, y1] = bounds
    const pad = 10
    // a tall view keeps the legend's band above the picture; a wide one has room beside it
    const top = cssW < cssH * 1.1 ? legend.offsetHeight + 16 : pad
    const w = Math.max(1, cssW - 2 * pad)
    const h = Math.max(1, cssH - top - pad)
    const s = Math.min(w / (x1 - x0), h / (y1 - y0))
    fit = { s, ox: pad + (w - (x1 - x0) * s) / 2 - x0 * s, oy: top + (h - (y1 - y0) * s) / 2 - y0 * s }
  }

  const roundRect = (c, x, y, w, h, r) => {
    c.beginPath()
    if (c.roundRect) c.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
    else c.rect(x, y, w, h) // Safari before 16
  }
  const drawBox = (c, b, color, px) => {
    const g = c.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h)
    g.addColorStop(0, color)
    g.addColorStop(1, darker(color, 120))
    roundRect(c, b.x, b.y, b.w, b.h, 8)
    c.fillStyle = g
    c.fill()
    c.lineWidth = px
    c.strokeStyle = COLORS.boxStroke
    c.stroke()
    c.fillStyle = COLORS.labelBar
    c.strokeStyle = COLORS.labelBarStroke
    for (const [x, y, w, h] of labelRects(b.w, b.h, labelSides, b.o)) {
      c.fillRect(b.x + x, b.y + y, w, h)
      c.strokeRect(b.x + x, b.y + y, w, h)
    }
    const [dx, dy, ds] = dotOf(b.w, b.h, b.o)
    c.beginPath()
    c.arc(b.x + dx + ds / 2, b.y + dy + ds / 2, ds / 2, 0, Math.PI * 2)
    c.fillStyle = COLORS.ink
    c.fill()
  }

  function draw(now = performance.now()) {
    frame = 0
    if (disposed || !cssW || !cssH) return
    const c = canvas.getContext('2d')
    c.setTransform(ratio, 0, 0, ratio, 0, 0)
    c.fillStyle = COLORS.background
    c.fillRect(0, 0, cssW, cssH)
    c.setTransform(ratio * fit.s, 0, 0, ratio * fit.s, ratio * fit.ox, ratio * fit.oy)
    const px = 1 / fit.s // one CSS pixel in mm

    // the pallet
    c.save()
    roundRect(c, 0, 0, pallet.width, pallet.length, 15)
    if (picture) {
      c.clip()
      c.drawImage(picture, 0, 0, pallet.width, pallet.length)
    } else {
      c.fillStyle = COLORS.palletFill
      c.fill()
    }
    c.restore()
    roundRect(c, 0, 0, pallet.width, pallet.length, 15)
    c.lineWidth = 1.5 * px
    c.strokeStyle = COLORS.palletStroke
    c.stroke()

    let k = 1
    if (drop) {
      k = clamp((now - drop.start) / DROP_MS, 0, 1)
      if (k >= 1) drop = null
    }
    const e = easeOut(k)
    const current = []
    for (const b of boxes) {
      const p = placingOf.get(b.id)
      if (p !== undefined && p < cur) drawBox(c, b, typeColor(b.t), px)
      else if (p === cur) current.push(b)
      else drawBox(c, b, COLORS.unplaced, px)
    }
    // the boxes of this placing come down into their place
    for (const b of current) {
      if (e < 1) drawBox(c, b, COLORS.unplaced, px)
      c.save()
      c.globalAlpha = e
      const grow = 1 + 0.16 * (1 - e)
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      c.translate(cx, cy)
      c.scale(grow, grow)
      c.translate(-cx, -cy)
      drawBox(c, b, COLORS.selected, px / grow)
      c.restore()
    }
    // the gripper over it, moving from the previous placing
    if (cur > 0) {
      let [gx, gy, gw, gh] = placings[cur - 1].gripper
      let alpha = 1
      if (drop?.from && e < 1) {
        const [fx, fy, fw, fh] = drop.from
        gx = fx + (gx - fx) * e
        gy = fy + (gy - fy) * e
        gw = fw + (gw - fw) * e
        gh = fh + (gh - fh) * e
      } else if (drop && !drop.from) alpha = e
      c.globalAlpha = 0.31 * alpha
      c.fillStyle = COLORS.gripper
      c.fillRect(gx, gy, gw, gh)
      c.globalAlpha = alpha
      c.lineWidth = 2 * px
      c.strokeStyle = COLORS.gripper
      c.strokeRect(gx, gy, gw, gh)
      c.globalAlpha = 1
    }
    if (drop) frame = requestAnimationFrame(draw)
  }
  const redraw = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(draw)
  }

  // ---- the controls
  let trackW = 0
  const placeThumb = () => {
    const sw = slider.clientWidth
    trackW = Math.max(0, sw - 52)
    thumb.style.transform = `translateX(${(trackW * cur) / N}px)`
    fill.style.transform = `scaleX(${cur / N})`
    ticks.forEach((t, i) => t.classList.toggle('on', i <= cur))
  }
  const showValue = () => {
    lCur.textContent = String(cur)
    lCount.textContent = cur > 0 ? String(placings[cur - 1].boxes.length) : '–'
    slider.setAttribute('aria-valuenow', String(cur))
    slider.setAttribute('aria-valuetext', label.textContent)
    placeThumb()
  }
  function showPlaying() {
    play.innerHTML = playing ? ICON_PAUSE : ICON_PLAY
    play.setAttribute('aria-label', playing ? texts.pause : texts.play)
  }
  const setValue = (k, animate = true) => {
    k = clamp(Math.round(k), 0, N)
    if (k === cur) return
    const prev = cur
    cur = k
    if (animate && k > 0) drop = { start: performance.now(), from: prev > 0 && Math.abs(k - prev) === 1 ? placings[prev - 1].gripper : null }
    else drop = null
    showValue()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    draw()
  }
  const schedule = () => {
    clearTimeout(timer)
    if (!playing || disposed) return
    timer = setTimeout(() => {
      setValue(cur >= N ? 0 : cur + 1)
      schedule()
    }, cur >= N ? END_PAUSE_MS : STEP_MS)
  }
  const setPlaying = (on) => {
    playing = on
    showPlaying()
    if (on && cur >= N) setValue(0)
    schedule()
  }

  // ---- gestures: the bar always keeps its touches; the drawing lets its edge strips through
  const guard = guardGestures(root, { always: (target) => controls.contains(target) })

  // the button acts on the pointer, not on click: a browser eats the click of a tap that comes
  // right after a fast swipe (it stops the swipe's fling with it); keyboard clicks still count
  let pressed = null
  play.addEventListener('pointerdown', (e) => {
    if (guard.passes(e) || (e.pointerType === 'mouse' && e.button !== 0)) return
    pressed = e.pointerId
    try { play.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
  })
  play.addEventListener('pointerup', (e) => {
    if (pressed !== e.pointerId) return
    pressed = null
    const r = play.getBoundingClientRect()
    if (e.clientX >= r.left - 8 && e.clientX <= r.right + 8 && e.clientY >= r.top - 8 && e.clientY <= r.bottom + 8) setPlaying(!playing)
  })
  play.addEventListener('pointercancel', () => { pressed = null })
  play.addEventListener('click', (e) => {
    if (e.detail === 0) setPlaying(!playing)
  })

  let sliding = null
  const valueAt = (clientX) => {
    const r = slider.getBoundingClientRect()
    return trackW ? ((clientX - r.left - 26) / trackW) * N : 0
  }
  const onSlideDown = (e) => {
    if (guard.passes(e) || (e.pointerType === 'mouse' && e.button !== 0)) return
    try { slider.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    sliding = e.pointerId
    if (playing) setPlaying(false)
    setValue(valueAt(e.clientX))
  }
  const onSlideMove = (e) => {
    if (sliding !== e.pointerId) return
    setValue(valueAt(e.clientX))
  }
  const onSlideUp = (e) => {
    if (sliding === e.pointerId) sliding = null
  }
  slider.addEventListener('pointerdown', onSlideDown)
  slider.addEventListener('pointermove', onSlideMove)
  slider.addEventListener('pointerup', onSlideUp)
  slider.addEventListener('pointercancel', onSlideUp)
  slider.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]
    if (step) {
      e.preventDefault()
      if (playing) setPlaying(false)
      setValue(cur + step)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setValue(e.key === 'Home' ? 0 : N)
    } else if (e.key === ' ') {
      e.preventDefault()
      setPlaying(!playing)
    }
  })

  // the drawing: a tap plays or pauses, a sideways drag steps
  let scrub = null
  const onViewDown = (e) => {
    if (guard.passes(e) || (e.pointerType === 'mouse' && e.button !== 0) || scrub) return
    try { viewEl.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    scrub = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, base: cur, moved: false, wasPlaying: playing }
  }
  const onViewMove = (e) => {
    if (!scrub || scrub.id !== e.pointerId) return
    const dx = e.clientX - scrub.x0
    if (!scrub.moved && Math.abs(dx) > 10) {
      scrub.moved = true
      if (playing) setPlaying(false)
    }
    if (scrub.moved) setValue(scrub.base + dx / SCRUB_PX)
  }
  const onViewUp = (e) => {
    if (!scrub || scrub.id !== e.pointerId) return
    const s = scrub
    scrub = null
    if (!s.moved && e.type === 'pointerup' && e.timeStamp - s.t0 < 500 && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 12) setPlaying(!playing)
  }
  viewEl.addEventListener('pointerdown', onViewDown)
  viewEl.addEventListener('pointermove', onViewMove)
  viewEl.addEventListener('pointerup', onViewUp)
  viewEl.addEventListener('pointercancel', onViewUp)

  let wheelAcc = 0
  const onWheel = (e) => {
    e.preventDefault()
    wheelAcc += e.deltaY
    if (Math.abs(wheelAcc) < 50) return
    if (playing) setPlaying(false)
    setValue(cur + Math.sign(wheelAcc))
    wheelAcc = 0
  }
  root.addEventListener('wheel', onWheel, { passive: false })

  // ---- size
  const resize = () => {
    const wide = root.clientWidth >= 560
    // a phone held sideways: the controls stand beside the drawing, which then gets the whole height
    const side = root.clientWidth > root.clientHeight * 2.2
    root.classList.toggle('side', side)
    controls.classList.toggle('side', side)
    controls.classList.toggle('wide', !side && wide)
    controls.classList.toggle('narrow', !side && !wide)
    cssW = viewEl.clientWidth
    cssH = viewEl.clientHeight
    ratio = pixelRatio()
    canvas.width = Math.max(1, Math.round(cssW * ratio))
    canvas.height = Math.max(1, Math.round(cssH * ratio))
    layout()
    placeThumb()
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(root)
  observer.observe(viewEl)
  observer.observe(slider)

  applyTexts()
  showValue()
  if (autoplay) setPlaying(true)

  return {
    /** For checks: the placing on show and whether it plays. */
    state: () => ({ value: cur, count: N, playing }),
    setLang(next) {
      texts = pick(next, TEXT)
      applyTexts()
      showValue()
      layout()
      redraw()
    },
    destroy() {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      observer.disconnect()
      guard.dispose()
      root.removeEventListener('wheel', onWheel)
      root.remove()
    },
  }
}
