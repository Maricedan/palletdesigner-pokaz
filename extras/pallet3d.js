// Live 3D pallet of the phone player: the pallet project of the examples (recordings/extras/pallet.json,
// made by record/extras-data.mjs) drawn the way the program's "Widok 3D" draws it
// (web/src/components/pallet3d/scene.ts: colours, lights, label plates), turned with a finger.
//
//   mount(host, data, { lang }) -> { destroy(), setLang(lang) }
//
// One finger turns the camera around the stack (never under the floor), two fingers zoom, a double
// tap goes back to the first view; a mouse drags and wheels. It turns slowly by itself until the
// first touch. Touches that start in the left or right edge strip go on to the player (its tab swipe).
import {
  AmbientLight,
  BoxGeometry,
  Color,
  ColorManagement,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LinearSRGBColorSpace,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from '../vendor/three.module.min.js'

import { ensureStyles, guardGestures, pick, pixelRatio, plForm } from './common.js'

// as the program: colours go to the screen as written, light intensities in the old units
ColorManagement.enabled = false
const LEGACY_LIGHT = Math.PI

const BACKGROUND = '#f0f0f0'
const WOOD = [0xb8945f, 0xc29e69, 0xad8954]
const WOOD_EDGE = 0x7a5f38
const SPACER_COLOR = 0x654321
const BOX_EDGE = 0x18202c
const LABEL_COLOR = 0x00b4c8
const CARTON = '#d2b48c'

const FOV = 40
const HOME = { az: 0.6, el: 0.42, zoom: 1 }
const AUTO_SPEED = 0.16 // rad/s, about 40 s a turn
const ROTATE_PER_PX = 0.0085
const FLOOR_CLEARANCE = 40 // mm the camera keeps above the floor
const MAX_ELEVATION = 1.45
const ZOOM_OUT = 2.2

const TEXT = {
  pl: {
    hint: 'Obrót: przeciągnij · Zoom: dwa palce · Widok: dwa dotknięcia',
    noGl: 'Widok 3D niedostępny na tym urządzeniu',
    stats: (layers, boxes, height) =>
      `${layers} ${plForm(layers, 'warstwa', 'warstwy', 'warstw')} · ${boxes} ${plForm(boxes, 'karton', 'kartony', 'kartonów')} · ${height} mm`,
  },
  en: {
    hint: 'Rotate: drag · Zoom: pinch · Reset: double tap',
    noGl: '3D view not available on this device',
    stats: (layers, boxes, height) => `${layers} ${layers === 1 ? 'layer' : 'layers'} · ${boxes} ${boxes === 1 ? 'carton' : 'cartons'} · ${height} mm`,
  },
}

/** Sides that show a label once the box is turned to `orientation` (web/src/components/canvas/boxGeometry.ts). */
function rotatedLabelSides(sides, orientation) {
  switch (orientation) {
    case 3: return { 1: sides['7'], 3: sides['1'], 5: sides['3'], 7: sides['5'] }
    case 5: return { 1: sides['5'], 3: sides['7'], 5: sides['1'], 7: sides['3'] }
    case 7: return { 1: sides['3'], 3: sides['5'], 5: sides['7'], 7: sides['1'] }
    default: return { 1: sides['1'], 3: sides['3'], 5: sides['5'], 7: sides['7'] }
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export function mount(host, data, { lang = 'pl' } = {}) {
  ensureStyles(host.ownerDocument)
  const root = document.createElement('div')
  root.className = 'pdx-root pdx-pallet3d'
  root.style.background = BACKGROUND
  host.appendChild(root)

  let texts = pick(lang, TEXT)
  const W = data.pallet.width
  const L = data.pallet.length
  const PH = data.pallet.height
  const BH = data.box.height
  const H = data.height
  const boxCount = data.layers.reduce((n, l) => n + l.boxes.length, 0)

  // ---- overlays: what is on the pallet, and how to turn it (fixed places, nothing moves)
  const info = document.createElement('div')
  info.className = 'pdx-chip pdx-info'
  info.style.cssText = 'left:10px;top:10px;flex-direction:column;align-items:flex-start;gap:1px;max-width:calc(100% - 20px)'
  const infoTitle = document.createElement('b')
  infoTitle.textContent = data.name
  const infoStats = document.createElement('span')
  infoStats.className = 'n'
  infoStats.style.marginLeft = '0'
  const hint = document.createElement('span')
  hint.className = 'pdx-hint-line'
  hint.style.cssText = 'font-size:12px;line-height:16px;color:#1a64d4;white-space:normal;transition:opacity .6s'
  info.append(infoTitle, infoStats, hint)

  const legend = document.createElement('div')
  legend.className = 'pdx-chip pdx-legend'
  legend.style.cssText = 'left:10px;bottom:10px;max-width:calc(100% - 20px)'
  const types = data.types?.length ? data.types : [{ id: null, name: data.box.name || 'Karton', color: CARTON, count: boxCount }]
  for (const t of types) {
    const item = document.createElement('span')
    const sw = document.createElement('i')
    sw.className = 'sw'
    sw.style.background = t.color
    const n = document.createElement('span')
    n.className = 'n'
    n.textContent = String(t.count)
    item.append(sw, document.createTextNode(t.name), n)
    legend.appendChild(item)
  }

  const applyTexts = () => {
    infoStats.textContent = texts.stats(data.layers.length, boxCount, Math.round(H))
    hint.textContent = texts.hint
  }
  applyTexts()

  // ---- renderer
  let renderer
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: 'default' })
  } catch {
    const msg = document.createElement('div')
    msg.className = 'pdx-msg'
    msg.textContent = texts.noGl
    root.append(msg, legend)
    return { destroy: () => root.remove(), setLang() {} }
  }
  renderer.outputColorSpace = LinearSRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.setPixelRatio(pixelRatio())
  const canvas = renderer.domElement
  canvas.setAttribute('aria-label', data.name)
  root.append(canvas, info, legend)

  const scene = new Scene()
  scene.background = new Color(BACKGROUND)
  const camera = new PerspectiveCamera(FOV, 1, 20, 40000)
  const owned = []
  const own = (r) => (owned.push(r), r)
  const cache = new Map()
  const shared = (key, make) => {
    let found = cache.get(key)
    if (!found) cache.set(key, (found = own(make())))
    return found
  }

  scene.add(new AmbientLight(0x404040, 2.1 * LEGACY_LIGHT))
  const sun = new DirectionalLight(0xffffff, 0.3 * LEGACY_LIGHT)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const reach = Math.max(W, L, H) * 0.9
  Object.assign(sun.shadow.camera, { near: 10, far: 12000, left: -reach, right: reach, top: reach, bottom: -reach })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 1.5
  scene.add(sun, sun.target)

  const content = new Group()
  scene.add(content)

  // ---- the floor: only the shadow on the light background
  const floor = new Mesh(own(new PlaneGeometry(W * 6, L * 6)), own(new ShadowMaterial({ opacity: 0.1 })))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  content.add(floor)

  // ---- the wooden pallet: EUR boards scaled to the pallet's size (x across the width, z along the length)
  const sx = W / 800
  const sz = L / 1200
  const sy = PH / 144
  const wood = WOOD.map((c) => own(new MeshLambertMaterial({ color: c })))
  const woodEdge = own(new LineBasicMaterial({ color: WOOD_EDGE, transparent: true, opacity: 0.5 }))
  const board = (w, h, d, x, y, z, shade) => {
    const g = own(new BoxGeometry(w, h, d))
    const m = new Mesh(g, wood[shade % wood.length])
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    const e = new LineSegments(own(new EdgesGeometry(g)), woodEdge)
    e.position.copy(m.position)
    content.add(m, e)
  }
  const along = [-527.5, 0, 527.5].map((z) => z * sz) // cross boards and blocks
  const rows = [-327.5, 0, 327.5].map((x) => x * sx) // bottom boards and blocks
  rows.forEach((x, i) => board(145 * sx, 22 * sy, L, x, 11 * sy, 0, i))
  rows.forEach((x, i) => along.forEach((z, j) => board(145 * sx, 78 * sy, 145 * sz, x, 61 * sy, z, i + j + 1)))
  along.forEach((z, j) => board(W, 22 * sy, 145 * sz, 0, 111 * sy, z, j + 2))
  ;[[-327.5, 145], [-164, 100], [0, 145], [163.5, 100], [327.5, 145]].forEach(([x, w], i) =>
    board(w * sx, 22 * sy, L, x * sx, 133 * sy, 0, i),
  )

  // ---- spacers and layers, as web/src/components/pallet3d/model.ts places them
  const spacers = new Set(data.spacers?.positions ?? [])
  const thickness = data.spacers?.thickness ?? 0
  const layerCenterY = (position) => {
    let y = PH
    for (let i = 0; i < position; i++) {
      if (i > 0) y += BH
      if (spacers.has(i)) y += thickness
    }
    return y + BH / 2
  }
  const spacerCenterY = (position) => {
    let y = PH
    for (let i = 1; i <= position; i++) {
      y += BH
      if (spacers.has(i - 1)) y += thickness
    }
    return y + Math.max(thickness, 5) / 2
  }
  const addSpacer = (position) => {
    const m = new Mesh(
      shared('spacer', () => new BoxGeometry(W * 0.95, Math.max(thickness, 5), L * 0.95)),
      shared('spacer-m', () => new MeshLambertMaterial({ color: SPACER_COLOR, transparent: true, opacity: 0.8 })),
    )
    m.position.y = spacerCenterY(position)
    m.castShadow = true
    content.add(m)
  }
  if (spacers.has(0)) addSpacer(0)

  const colorOf = new Map((data.types ?? []).map((t) => [t.id, t.color]))
  const edgeMaterial = own(new LineBasicMaterial({ color: BOX_EDGE, transparent: true, opacity: 0.6 }))
  const plateMaterial = own(new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }))
  const labelMaterial = own(new MeshLambertMaterial({ color: LABEL_COLOR, transparent: true, opacity: 0.9 }))
  const addLabels = (centre, w, h, d, sides) => {
    const size = Math.min(h * 0.5, 40)
    const faces = [
      { side: '1', span: w, normal: new Vector3(0, 0, -1), turn: Math.PI, reach: d / 2 },
      { side: '3', span: d, normal: new Vector3(1, 0, 0), turn: Math.PI / 2, reach: w / 2 },
      { side: '5', span: w, normal: new Vector3(0, 0, 1), turn: 0, reach: d / 2 },
      { side: '7', span: d, normal: new Vector3(-1, 0, 0), turn: -Math.PI / 2, reach: w / 2 },
    ]
    for (const f of faces) {
      if (!sides[f.side]) continue
      const s = Math.min(f.span * 0.6, 50, size)
      const plate = new Mesh(shared(`plane:${s * 1.3}`, () => new PlaneGeometry(s * 1.3, s * 1.3)), plateMaterial)
      plate.position.copy(centre).addScaledVector(f.normal, f.reach + 1)
      plate.rotation.y = f.turn
      const label = new Mesh(shared(`plane:${s}`, () => new PlaneGeometry(s, s)), labelMaterial)
      label.position.copy(plate.position).addScaledVector(f.normal, 0.4)
      label.rotation.y = f.turn
      content.add(plate, label)
    }
  }
  for (const layer of data.layers) {
    const y = layerCenterY(layer.position)
    for (const b of layer.boxes) {
      const key = `${b.w}x${BH}x${b.d}`
      const geometry = shared(`box:${key}`, () => new BoxGeometry(b.w, BH, b.d))
      const color = (b.t != null && colorOf.get(b.t)) || CARTON
      const mesh = new Mesh(geometry, shared(`m:${color}`, () => new MeshLambertMaterial({ color: new Color(color) })))
      mesh.position.set(b.x + b.w / 2 - W / 2, y, b.y + b.d / 2 - L / 2)
      mesh.castShadow = true
      mesh.receiveShadow = true
      const edges = new LineSegments(shared(`edges:${key}`, () => new EdgesGeometry(geometry)), edgeMaterial)
      edges.position.copy(mesh.position)
      content.add(mesh, edges)
      addLabels(mesh.position, b.w, BH, b.d, rotatedLabelSides(layer.labelSides ?? data.box.labelSides ?? {}, b.o))
    }
    if (spacers.has(layer.position)) addSpacer(layer.position)
  }

  // ---- the camera: around the middle of the stack
  const target = new Vector3(0, H / 2, 0)
  const radius = 0.5 * Math.hypot(W, L, H)
  const view = { ...HOME }
  // the distance at which the whole stack fits the picture from the first view, whatever way it is
  // turned: half its footprint's diagonal across, its height seen from the first view's elevation down
  const across = 0.5 * Math.hypot(W, L)
  const down = 0.5 * (H * Math.cos(HOME.el) + 2 * across * Math.sin(HOME.el))
  const homeDistance = () => {
    const tanV = Math.tan((FOV * Math.PI) / 360)
    const tanH = tanV * camera.aspect
    return Math.max(down / tanV, across / tanH) * 1.12 + across * 0.5
  }
  const zoomIn = () => Math.max(0.45, (radius * 1.3) / homeDistance())
  // a wide view moves the stack's picture a little right, away from the chips at the left
  const shift = () => {
    camera.clearViewOffset()
    if (width > height * 1.3) {
      const dx = Math.min(info.offsetWidth + 20, width * 0.4) / 4
      camera.setViewOffset(width, height, -dx, 0, width, height)
    }
  }
  const minElevation = (dist) => Math.asin(clamp((FLOOR_CLEARANCE - target.y) / dist, -1, 1))
  const right = new Vector3()
  const back = new Vector3()
  const up = new Vector3(0, 4500, 0)
  const place = () => {
    view.zoom = clamp(view.zoom, zoomIn(), ZOOM_OUT)
    const dist = homeDistance() * view.zoom
    view.el = clamp(view.el, minElevation(dist), MAX_ELEVATION)
    const c = Math.cos(view.el)
    camera.position.set(target.x + dist * c * Math.sin(view.az), target.y + dist * Math.sin(view.el), target.z + dist * c * Math.cos(view.az))
    camera.lookAt(target)
    // the light keeps the program's place relative to the camera: right, above and a little in front
    right.set(Math.cos(view.az), 0, -Math.sin(view.az))
    back.set(Math.sin(view.az), 0, Math.cos(view.az))
    sun.position.copy(target).addScaledVector(right, 1600).addScaledVector(back, 1000).add(up)
    sun.target.position.copy(target)
  }

  // ---- drawing on demand: a frame only while something moves
  let width = 0
  let height = 0
  let frame = 0
  let last = 0
  let auto = true
  let spin = 0 // rad/s left from a flick
  let tween = null
  let disposed = false
  const render = () => {
    if (!width || !height || disposed) return
    place()
    renderer.render(scene, camera)
  }
  const tick = (now) => {
    frame = 0
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0
    last = now
    let moving = false
    if (tween) {
      const t = clamp((now - tween.start) / tween.ms, 0, 1)
      const k = ease(t)
      for (const key of ['az', 'el', 'zoom']) view[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * k
      if (t >= 1) tween = null
      else moving = true
    } else if (auto) {
      view.az += AUTO_SPEED * dt
      moving = true
    } else if (Math.abs(spin) > 0.02) {
      view.az += spin * dt
      spin *= Math.exp(-dt * 3.2)
      moving = true
    }
    render()
    if (moving && width && height) request()
    else last = 0
  }
  const request = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(tick)
  }
  const redraw = () => {
    if (!frame) render()
  }

  const resize = () => {
    width = root.clientWidth
    height = root.clientHeight
    if (!width || !height) return
    renderer.setPixelRatio(pixelRatio())
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    shift()
    camera.updateProjectionMatrix()
    render()
    request()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(root)

  const onLost = (e) => e.preventDefault()
  const onRestored = () => request()
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  // ---- gestures
  const guard = guardGestures(root)
  const pointers = new Map()
  let drag = null
  let pinch = null
  let lastTap = null
  const touched = () => {
    if (auto) {
      auto = false
      hint.style.opacity = '0.55'
    }
    tween = null
    spin = 0
  }
  const spread = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y) || 1
  }
  const resetView = () => {
    const turn = Math.PI * 2
    const to = { ...HOME, az: HOME.az + Math.round((view.az - HOME.az) / turn) * turn }
    tween = { from: { az: view.az, el: view.el, zoom: view.zoom }, to, start: performance.now(), ms: 500 }
    spin = 0
    request()
  }
  const onDown = (e) => {
    if (guard.passes(e)) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    try { root.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    touched()
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 1) {
      drag = { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, x: e.clientX, y: e.clientY, t: e.timeStamp, v: 0, moved: false }
    } else if (pointers.size === 2) {
      drag = null
      pinch = { d0: spread(), zoom0: view.zoom }
    }
  }
  const onMove = (e) => {
    if (guard.passes(e) || !pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch && pointers.size >= 2) {
      view.zoom = pinch.zoom0 * (pinch.d0 / spread())
      redraw()
    } else if (drag) {
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      const dt = Math.max(8, e.timeStamp - drag.t)
      view.az -= dx * ROTATE_PER_PX
      view.el += dy * ROTATE_PER_PX
      drag.v = 0.6 * drag.v + 0.4 * ((-dx * ROTATE_PER_PX) / dt) * 1000
      drag.x = e.clientX
      drag.y = e.clientY
      drag.t = e.timeStamp
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.moved = true
      redraw()
    }
  }
  const onUp = (e) => {
    if (guard.passes(e) || !pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)
    if (pinch) {
      if (pointers.size < 2) pinch = null
      if (pointers.size === 1) {
        // the finger left on the glass turns on from where it is, without a jump
        const [p] = pointers.values()
        drag = { x0: p.x, y0: p.y, t0: e.timeStamp, x: p.x, y: p.y, t: e.timeStamp, v: 0, moved: true }
      }
      return
    }
    if (pointers.size || !drag) return
    const d = drag
    drag = null
    if (!d.moved && e.type === 'pointerup' && e.timeStamp - d.t0 < 400) {
      if (lastTap && e.timeStamp - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap = null
        resetView()
      } else lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp }
      return
    }
    if (e.timeStamp - d.t < 90 && Math.abs(d.v) > 0.3) {
      spin = clamp(d.v, -6, 6)
      request()
    }
  }
  const onWheel = (e) => {
    if (guard.passes(e)) return
    e.preventDefault()
    touched()
    view.zoom *= Math.exp(e.deltaY * 0.0012)
    redraw()
  }
  root.addEventListener('pointerdown', onDown)
  root.addEventListener('pointermove', onMove)
  root.addEventListener('pointerup', onUp)
  root.addEventListener('pointercancel', onUp)
  root.addEventListener('wheel', onWheel, { passive: false })

  return {
    setLang(next) {
      texts = pick(next, TEXT)
      applyTexts()
      resize()
    },
    /** For checks: where the camera is. */
    state: () => ({ az: view.az, el: view.el, zoom: view.zoom, auto, cameraY: camera.position.y, minEl: minElevation(homeDistance() * view.zoom) }),
    destroy() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      guard.dispose()
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
      root.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      content.clear()
      scene.clear()
      for (const r of owned) r.dispose()
      owned.length = 0
      renderer.dispose()
      // a browser keeps only about 16 WebGL contexts: give this one back now
      renderer.forceContextLoss()
      root.remove()
    },
  }
}
