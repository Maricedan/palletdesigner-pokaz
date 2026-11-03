// Shared parts of the live extras (pallet3d.js, placing-live.js): their styles and the rule that
// decides which touches they keep and which go on to the player.

const STYLE_ID = 'pdx-style'

const CSS = `
.pdx-root { position: absolute; inset: 0; overflow: hidden; touch-action: none; user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  font-family: inherit; color: #101b2d; contain: strict; }
.pdx-root canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; outline: none; }
.pdx-chip { position: absolute; display: flex; align-items: center; gap: 6px 12px; flex-wrap: wrap;
  padding: 6px 10px; border-radius: 10px; background: rgba(255,255,255,.86); box-shadow: 0 1px 3px rgba(16,27,45,.18);
  font-size: 13px; line-height: 18px; white-space: nowrap; pointer-events: none; }
.pdx-chip .sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 5px; vertical-align: -1px;
  box-shadow: inset 0 0 0 1px rgba(16,27,45,.25); }
.pdx-chip .n { font-variant-numeric: tabular-nums; color: #5b6a80; margin-left: 4px; }
.pdx-chip b { font-weight: 600; }
.pdx-hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-size: 12px; line-height: 16px;
  color: #5b6a80; pointer-events: none; transition: opacity .6s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 10%; }
.pdx-hint.dim { opacity: .45; }
.pdx-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center;
  font-size: 15px; color: #5b6a80; padding: 16px; }

/* placing-live */
.pdx-placing { display: flex; flex-direction: column; background: #f7fafd; }
.pdx-view { position: relative; flex: 1 1 auto; min-height: 0; }
.pdx-controls { flex: 0 0 auto; position: relative; display: grid; align-items: center; column-gap: 12px;
  background: #ffffff; border-top: 1px solid #dbe3ec; touch-action: none;
  padding: 0 max(12px, env(safe-area-inset-right, 0px)) 0 max(12px, env(safe-area-inset-left, 0px)); }
.pdx-controls.wide { height: 84px; grid-template-columns: 60px 1fr; grid-template-rows: 24px 56px; align-content: center;
  grid-template-areas: "play label" "play slider"; }
.pdx-controls.wide .pdx-label { padding-left: 26px; align-self: end; }
.pdx-placing.side { flex-direction: row; }
.pdx-controls.side { width: 290px; height: auto; border-top: 0; border-left: 1px solid #dbe3ec; grid-template-columns: 60px 1fr;
  grid-template-rows: 40px 60px; align-content: center; grid-template-areas: "label label" "play slider"; }
.pdx-controls.side .pdx-label { justify-self: center; align-self: center; }
.pdx-controls.narrow { height: 112px; grid-template-columns: 60px 1fr; grid-template-rows: 40px 60px; align-content: center;
  grid-template-areas: "label label" "play slider"; }
.pdx-play { grid-area: play; width: 60px; height: 60px; border-radius: 50%; border: 0; padding: 0; margin: 0;
  background: #1a64d4; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
  box-shadow: 0 2px 6px rgba(26,100,212,.35); touch-action: none; }
.pdx-play:active { background: #0f4fae; }
.pdx-play svg { width: 26px; height: 26px; display: block; }
.pdx-label { grid-area: label; font-size: 17px; line-height: 22px; white-space: nowrap; font-variant-numeric: tabular-nums;
  overflow: hidden; height: 22px; }
.pdx-controls.narrow .pdx-label { justify-self: center; align-self: center; }
.pdx-label .num { display: inline-block; text-align: right; }
.pdx-label .of { color: #5b6a80; }
.pdx-label .sep { color: #c3d0e0; margin: 0 .45em; }
.pdx-slider { grid-area: slider; position: relative; height: 56px; cursor: pointer; touch-action: none; outline: none; min-width: 120px; }
.pdx-track { position: absolute; left: 26px; right: 26px; top: 50%; height: 10px; margin-top: -5px; border-radius: 5px; background: #dbe3ec; }
.pdx-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; border-radius: 5px; background: #4caf50;
  transform-origin: 0 50%; transform: scaleX(0); }
.pdx-tick { position: absolute; top: -4px; width: 2px; height: 18px; margin-left: -1px; border-radius: 1px; background: #c3d0e0; }
.pdx-tick.on { background: #2e7d32; }
.pdx-thumb { position: absolute; left: 0; top: 50%; width: 52px; height: 52px; margin: -26px 0 0 0; border-radius: 50%;
  background: #fff; border: 3px solid #1a64d4; box-sizing: border-box; box-shadow: 0 2px 8px rgba(16,27,45,.25);
  will-change: transform; pointer-events: none; }
.pdx-slider:focus-visible .pdx-thumb { box-shadow: 0 0 0 4px rgba(26,100,212,.35); }
`

export function ensureStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.appendChild(style)
}

const POINTER = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']
const OTHER = ['wheel', 'click', 'dblclick', 'contextmenu']
const TOUCH = ['touchstart', 'touchmove', 'touchend', 'touchcancel']

/**
 * Keeps the gestures that start inside `root` from reaching the player, except those that start in
 * a strip along the left or right edge (`edge` of the visible width): those are the player's tab
 * swipe and go on untouched. A touch that joins a passing gesture passes too.
 * `always(target)` names elements kept whatever the place (the placing's controls).
 * Returns { passes(event), dispose() }: handlers inside skip an event for which passes() is true.
 */
export function guardGestures(root, { edge = 0.08, always = () => false } = {}) {
  const passPointers = new Set()
  const passTouches = new Set()
  const passed = new WeakSet()

  const strip = (x, target) => {
    if (always(target)) return false
    const r = root.getBoundingClientRect()
    const left = Math.max(r.left, 0)
    const right = Math.min(r.right, window.innerWidth || r.right)
    const width = right - left
    if (width <= 0) return false
    const w = Math.max(18, width * edge)
    return x < left + w || x > right - w
  }

  // capture phase on the root: decide before any handler inside sees the event
  const classify = (e) => {
    if (e.type === 'pointerdown') {
      if (passPointers.size || strip(e.clientX, e.target)) passPointers.add(e.pointerId)
    }
    if (e.type === 'touchstart') {
      for (const t of e.changedTouches) {
        if (passTouches.size || strip(t.clientX, e.target)) passTouches.add(t.identifier)
      }
    }
    let pass = false
    if (e.pointerId !== undefined && POINTER.includes(e.type)) pass = passPointers.has(e.pointerId)
    else if (TOUCH.includes(e.type)) pass = [...e.changedTouches].every((t) => passTouches.has(t.identifier))
    if (pass) passed.add(e)
  }
  // a passing pointer is captured by the player and ends outside the root: forget it on the window,
  // after the whole dispatch
  const ended = (e) => {
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      const id = e.pointerId
      setTimeout(() => passPointers.delete(id), 0)
    } else {
      const ids = [...e.changedTouches].map((t) => t.identifier)
      setTimeout(() => ids.forEach((id) => passTouches.delete(id)), 0)
    }
  }
  const ENDS = ['pointerup', 'pointercancel', 'touchend', 'touchcancel']
  for (const t of ENDS) window.addEventListener(t, ended, { capture: true, passive: true })
  // bubble phase on the root: what is ours stops here, the player above never sees it
  const stop = (e) => {
    if (passed.has(e)) return
    e.stopPropagation()
    if (e.type === 'touchmove' && e.cancelable) e.preventDefault()
  }

  const types = [...POINTER, ...OTHER, ...TOUCH]
  for (const t of types) {
    root.addEventListener(t, classify, { capture: true, passive: true })
    root.addEventListener(t, stop, { passive: t !== 'touchmove' && t !== 'wheel' })
  }
  return {
    passes: (e) => passed.has(e),
    dispose() {
      for (const t of ENDS) window.removeEventListener(t, ended, { capture: true })
      for (const t of types) {
        root.removeEventListener(t, classify, { capture: true })
        root.removeEventListener(t, stop)
      }
    },
  }
}

/** Polish noun form for a count: 1 karton, 2-4 kartony, 5+ kartonów (12-14 too). */
export function plForm(n, one, few, many) {
  if (n === 1) return one
  const d = n % 10
  const h = n % 100
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many
}

export const pick = (lang, texts) => texts[lang] ?? texts.pl

/** Device pixel ratio for canvases, capped (a phone at 3x would draw 2.25 times the pixels for little gain). */
export const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2)
