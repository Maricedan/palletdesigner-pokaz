// The live extras of the mock-up, drawn on the phone from the example package's data: the 3D pallet on the Pallet
// tab and the placing replay on the Move tab (player/extras/, media/extras/*.json, record/extras-data.mjs). A button
// over the tab's stage opens one over the stage; it closes with its own button, on any tab change, or with a swipe
// that starts at the left or right edge (the modules let those through), which also moves to the next tab.
const LIVE = {
  pallet: { module: './extras/pallet3d.js', label: 'live3d', hint: 'live3dHint' },
  move: { module: './extras/placing-live.js', label: 'livePlacing', hint: 'livePlacingHint' },
}

export class Live {
  constructor(program) {
    this.program = program
    this.app = program.app
    this.stage = program.stage
    this.tab = null
    this.handle = null
    this.opening = 0

    this.btn = document.createElement('button')
    this.btn.type = 'button'
    this.btn.className = 'live-btn'
    this.btn.hidden = true
    this.btn.innerHTML = '<svg class="ico"><use href="#i-play"/></svg><span></span>'
    this.btn.addEventListener('click', () => this.open())

    this.layer = document.createElement('div')
    this.layer.className = 'live-layer'
    this.layer.hidden = true
    this.host = document.createElement('div')
    this.host.className = 'live-host'
    this.closeBtn = document.createElement('button')
    this.closeBtn.type = 'button'
    this.closeBtn.className = 'live-close'
    this.closeBtn.innerHTML = '<span></span><b aria-hidden="true">✕</b>'
    this.closeBtn.addEventListener('click', () => this.close())
    this.layer.append(this.host, this.closeBtn)
    program.root.append(this.btn, this.layer)

    // the edge swipes the modules do not keep
    let start = null
    this.layer.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId } })
    this.layer.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      start = null
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      const to = this.program.idx + (dx < 0 ? 1 : -1)
      this.close()
      this.program.go(to)
    })
    this.layer.addEventListener('pointercancel', () => { start = null })
    new ResizeObserver(() => this.place()).observe(this.stage)
  }

  available(tab) {
    return !!LIVE[tab] && !!this.app.data?.live?.[tab]
  }

  /** The tab on screen changed (or its caption): the button only where there is something live. */
  update(tab) {
    if (this.handle && tab !== this.tab) this.close()
    this.tab = tab
    const spec = LIVE[tab]
    this.btn.hidden = !this.available(tab) || !this.layer.hidden
    if (spec) this.btn.querySelector('span').textContent = this.app.t(spec.label)
    this.closeBtn.querySelector('span').textContent = this.app.t('liveClose')
    this.place()
  }

  place() {
    const s = this.stage
    const root = this.program.root
    if (!s.offsetWidth) return
    // the button in the stage's top right corner, the live view over the stage (held upright the stage is tall,
    // and the Back / Next bar under the caption stays free)
    Object.assign(this.btn.style, { top: `${s.offsetTop + 10}px`, left: 'auto', right: `${root.clientWidth - s.offsetLeft - s.offsetWidth + 10}px` })
    Object.assign(this.layer.style, { top: `${s.offsetTop}px`, left: `${s.offsetLeft}px`, width: `${s.offsetWidth}px`, height: `${s.offsetHeight}px` })
  }

  async open() {
    const tab = this.tab
    const spec = LIVE[tab]
    if (!spec || this.handle || !this.available(tab)) return
    const ticket = ++this.opening
    this.program.finishPlaying()
    this.layer.hidden = false
    this.btn.hidden = true
    this.place()
    this.app.setCaption(this.program.capText, this.app.t(spec.label), this.app.t(spec.hint))
    try {
      const [module, data] = await Promise.all([
        import(spec.module),
        fetch(`media/${this.app.data.live[tab]}`).then((r) => {
          if (!r.ok) throw new Error(r.status)
          return r.json()
        }),
      ])
      if (ticket !== this.opening || this.layer.hidden) return
      this.handle = module.mount(this.host, data, { lang: this.app.lang })
      this.app.root.dataset.live = tab
    } catch {
      if (ticket !== this.opening) return
      this.close()
      this.app.flash(this.app.t('clipError'))
    }
  }

  close() {
    this.opening++
    if (this.handle) {
      try {
        this.handle.destroy()
      } catch {
        // already gone
      }
    }
    this.handle = null
    this.host.textContent = ''
    delete this.app.root.dataset.live
    if (this.layer.hidden) return
    this.layer.hidden = true
    this.btn.hidden = !this.available(this.tab)
    this.program.caption()
  }
}
