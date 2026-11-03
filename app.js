// Phone player of the PalletDesigner demo: start screen, offline cache, film, and the two modes
// (modes.js). Data: media/scenes.json (tools/phone-demo/README.md); file list: precache.json (build.mjs).
import { Clips, testHooks } from './stage.js'
import { ProgramMode, StoryMode } from './modes.js'
import { MaterialsMode } from './materials.js'

const TEXT = {
  pl: {
    program: 'Program',
    programSub: 'Makieta zakładek: przesuń, przybliż, dotknij',
    stories: 'Historie',
    film: 'Film 69 s',
    filmSub: 'Film reklamowy',
    loop: 'Pokaz ciągły',
    loopSub: 'wszystkie historie w pętli',
    restart: 'Od początku',
    home: 'Start',
    exit: 'Wyjdź',
    tapPlays: 'Dotknij',
    nextScene: 'Dalej',
    swipeNext: 'Przesuń w bok',
    lastTab: 'Ostatnia zakładka',
    storyEnd: 'Koniec historii',
    share: 'Wyślij broszurę',
    nextStory: 'Następna historia',
    replay: 'Jeszcze raz',
    startScreen: 'Ekran startowy',
    scan: 'Pokaz na własnym telefonie',
    offReady: 'Offline gotowe',
    offUpdate: 'Nowa wersja – odśwież',
    offLoading: 'Zapis offline',
    offError: 'Offline: błąd, dotknij',
    offNone: 'Offline niedostępne',
    offCheck: 'Sprawdzanie…',
    loading: 'Ładowanie…',
    clipError: 'Brak nagrania',
    blocked: 'Wideo zablokowane: wyłącz tryb oszczędzania energii',
    back: 'Wróć',
    navBack: 'Wstecz',
    navNext: 'Dalej',
    fullscreen: 'Pełny ekran',
    fsIos: 'Pełny ekran: Udostępnij → Do ekranu początkowego',
    live3d: 'Paleta 3D na żywo',
    live3dHint: 'Jeden palec obraca, dwa przybliżają',
    livePlacing: 'Odłożenia na żywo',
    livePlacingHint: 'Suwak: odłożenie po odłożeniu',
    liveClose: 'Zamknij',
    seconds: 's',
    matSlides: ['slajd', 'slajdy', 'slajdów'],
    shortDeck: 'Prezentacja – najważniejsze',
    dataFlow: 'Przepływ danych',
  },
  en: {
    program: 'Program',
    programSub: 'Tab mock-up: swipe, zoom, tap',
    stories: 'Stories',
    film: 'Film 69 s',
    filmSub: 'Promo film',
    loop: 'Continuous show',
    loopSub: 'all stories in a loop',
    restart: 'Start over',
    home: 'Start',
    exit: 'Exit',
    tapPlays: 'Tap',
    nextScene: 'Next',
    swipeNext: 'Swipe sideways',
    lastTab: 'Last tab',
    storyEnd: 'End of story',
    share: 'Send brochure',
    nextStory: 'Next story',
    replay: 'Again',
    startScreen: 'Start screen',
    scan: 'The demo on your own phone',
    offReady: 'Offline ready',
    offUpdate: 'New version – reload',
    offLoading: 'Saving offline',
    offError: 'Offline: error, tap',
    offNone: 'Offline unavailable',
    offCheck: 'Checking…',
    loading: 'Loading…',
    clipError: 'Recording missing',
    blocked: 'Video blocked: turn off Low Power Mode',
    back: 'Back',
    navBack: 'Back',
    navNext: 'Next',
    fullscreen: 'Full screen',
    fsIos: 'Full screen: Share → Add to Home Screen',
    live3d: 'Live 3D pallet',
    live3dHint: 'One finger turns, two zoom',
    livePlacing: 'Live placings',
    livePlacingHint: 'Slider: placing by placing',
    liveClose: 'Close',
    seconds: 's',
    matSlides: ['slide', 'slides', 'slides'],
    shortDeck: 'Presentation – highlights',
    dataFlow: 'Data flow',
  },
}

const BROCHURE = { pl: 'docs/broszura-PL.pdf', en: 'docs/brochure-EN.pdf' }
const PARAMS = new URLSearchParams(location.search)

const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

// Fullscreen API, prefixed in older Safari (iPad); iPhone Safari has none for a page.
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null
function requestFs() {
  const de = document.documentElement
  if (de.requestFullscreen) return de.requestFullscreen({ navigationUI: 'hide' })
  if (de.webkitRequestFullscreen) { de.webkitRequestFullscreen(); return Promise.resolve() }
  return Promise.reject(new Error('no fullscreen'))
}
function exitFs() {
  if (document.exitFullscreen) return document.exitFullscreen()
  if (document.webkitExitFullscreen) document.webkitExitFullscreen()
  return Promise.resolve()
}

class App {
  constructor() {
    this.root = document.getElementById('app')
    this.lang = store.get('pd-lang') === 'en' ? 'en' : 'pl'
    // ?lang=pl|en sets the language for this run only (scripts recording the player).
    if (PARAMS.get('lang') === 'pl' || PARAMS.get('lang') === 'en') this.lang = PARAMS.get('lang')
    this.clips = new Clips()
    this.data = null
    this.mat = null // media/materials/materials.json, null without it (then story E keeps its own tile)
    this.view = 'home'
    this.offline = { state: 'idle', pct: 0 }
    this.t = (k) => TEXT[this.lang][k] ?? TEXT.pl[k] ?? k
  }

  text(v) {
    if (v == null) return ''
    if (typeof v === 'string') return v
    return v[this.lang] ?? v.pl ?? Object.values(v)[0] ?? ''
  }

  // Recording language of a tab: the shown language when every scene of the tab has it, else Polish
  // (scenes of one tab chain frame to frame, so a tab never mixes languages). Captions switch anyway.
  tabLang(tabId) {
    if (this.lang === 'pl') return 'pl'
    const key = `${this.lang}:${tabId}`
    this.tabLangs ??= new Map()
    if (!this.tabLangs.has(key)) {
      const tab = this.data.tabs.find((t) => t.id === tabId)
      const ids = tab?.scenes || Object.keys(this.data.scenes).filter((id) => this.data.scenes[id].tab === tabId)
      const all = ids.length > 0 && ids.every((id) => this.data.scenes[id]?.media?.[this.lang])
      this.tabLangs.set(key, all ? this.lang : 'pl')
    }
    return this.tabLangs.get(key)
  }

  // Media of a scene in the shown language; paths resolved under media/.
  media(scene) {
    const m = scene.media[this.tabLang(scene.tab)] || scene.media.pl || Object.values(scene.media)[0]
    const res = (p) => (p ? `media/${p}` : p)
    return { ...m, clip: res(m.clip), start: res(m.start), end: res(m.end) }
  }

  // A tab without scenes shows its optional still (tab.still: path or { pl, en }).
  tabStill(tab) {
    const s = tab.still
    if (!s) return null
    const p = typeof s === 'string' ? s : (s[this.lang] || s.pl)
    return p ? `media/${p}` : null
  }

  thumb(path) {
    return `thumbs/${path.replace(/^media\//, '').replace(/[/\\]/g, '_')}`
  }

  async start() {
    document.documentElement.lang = this.lang
    this.program = new ProgramMode(this)
    this.story = new StoryMode(this)
    this.materials = new MaterialsMode(this)
    this.bindChrome()
    this.setupFullscreen()
    // the presentation and materials are optional: a site built without them shows story E's tile
    const mat = fetch('media/materials/materials.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => (m?.items?.length ? m : null), () => null)
    try {
      const r = await fetch('media/scenes.json')
      if (!r.ok) throw new Error(r.status)
      this.data = await r.json()
    } catch (e) {
      this.flash(`media/scenes.json: ${e.message}`)
      return
    }
    this.mat = await mat
    this.renderHome()
    this.applyText()
    this.root.dataset.ready = '1'
    if (this.fsHint) this.flash(this.t('fsIos'), 6000)
    // Started by a script: ?story=A&auto=1 plays story A through to its end card and stays there,
    // ?continuous=1 starts the continuous show. auto=1 skips the offline download (recording run).
    const auto = PARAMS.get('auto') === '1'
    if (!auto) this.offlineSetup()
    const storyId = PARAMS.get('story')
    if (PARAMS.get('continuous') === '1') this.show('story', { story: 0, loop: true })
    else if (storyId) {
      const i = this.data.stories.findIndex((s) => s.id.toLowerCase() === storyId.toLowerCase())
      this.show('story', { story: Math.max(0, i), loop: false, once: auto })
    }
    this.updateState()
  }

  // Coarse state for scripts: window.__demo.state and <body data-state>.
  demoState() {
    if (!this.data) return 'loading'
    if (this.view === 'story') {
      const ph = this.story.phase
      return ph === 'card' ? 'end-card' : ph === 'idle' ? 'loading' : 'playing'
    }
    return this.view
  }

  updateState() {
    document.body.dataset.state = this.demoState()
  }

  bindChrome() {
    for (const b of document.querySelectorAll('.lang button')) {
      b.addEventListener('click', () => this.setLang(b.dataset.lang))
    }
    document.getElementById('tile-program').addEventListener('click', () => this.show('program'))
    document.getElementById('tile-film').addEventListener('click', () => this.show('film'))
    document.getElementById('btn-loop').addEventListener('click', () => this.show('story', { story: 0, loop: true }))
    document.querySelector('#program .home-btn').addEventListener('click', () => this.show('home'))
    document.querySelector('#film .back').addEventListener('click', () => this.show('home'))
    document.getElementById('offline').addEventListener('click', () => {
      if (this.offline.state === 'error') this.offlineSetup()
      else if (this.offline.state === 'update') location.reload()
    })
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.show('home'); return }
      if (this.view === 'program') this.program.key(e.key)
      else if (this.view === 'story') this.story.key(e.key)
      else if (this.view === 'materials') this.materials.key(e.key)
    })
    // The player zooms by itself: keep the browser from zooming or scrolling the page.
    document.addEventListener('gesturestart', (e) => e.preventDefault())
    document.addEventListener('touchmove', (e) => {
      if (!e.target.closest?.('.scroll')) e.preventDefault()
    }, { passive: false })
    // Wake lock, full screen and video playback need a user gesture.
    const gesture = () => { this.wake(); this.fullscreen(); this.unlockVideo() }
    window.addEventListener('pointerup', gesture, true)
    window.addEventListener('touchend', gesture, true)
    window.addEventListener('click', gesture, true)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wakeWanted) this.wake()
    })
  }

  // iOS (Low Power Mode) lets an element play from a timer only after play() was called on it during a
  // gesture: call it once on every empty video element.
  unlockVideo() {
    for (const v of document.querySelectorAll('video')) {
      if (v.dataset.unlocked || v.getAttribute('src')) continue
      v.dataset.unlocked = '1'
      try { v.play().catch(() => {}) } catch { /* ignore */ }
    }
  }

  async wake() {
    this.wakeWanted = true
    if (this.wakeLock || !navigator.wakeLock) return
    try {
      this.wakeLock = await navigator.wakeLock.request('screen')
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null })
    } catch { /* refused: battery saver or not visible */ }
  }

  // Full screen: asked for on the first gesture, and on a phone again on a later one when it ended by itself (the
  // system back gesture, leaving the app); the button in the top bar switches it on and off, and off with the button
  // stays off. Not offered when the page runs as an installed app or the browser has no Fullscreen API (iPhone:
  // a one-time hint to add the page to the home screen). ?nofs and ?auto=1 never ask by themselves.
  setupFullscreen() {
    const de = document.documentElement
    const api = !!((document.fullscreenEnabled && de.requestFullscreen)
      || (document.webkitFullscreenEnabled && de.webkitRequestFullscreen))
    const installed = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches
      || navigator.standalone === true
    this.fsOffered = api && !installed
    this.fsWanted = this.fsOffered && !PARAMS.has('nofs') && PARAMS.get('auto') !== '1'
    this.fsHint = !api && !installed && /iPhone|iPod/.test(navigator.userAgent) && !store.get('pd-fs-hint')
    if (this.fsHint) store.set('pd-fs-hint', '1')
    for (const b of document.querySelectorAll('.fs-btn')) {
      b.hidden = !this.fsOffered
      b.addEventListener('click', () => this.toggleFullscreen())
    }
    const changed = () => {
      // with a mouse, leaving full screen (Esc) is a decision; on a phone the next touch asks again
      if (!fsElement() && !matchMedia('(pointer: coarse)').matches) this.fsWanted = false
      this.renderFs()
    }
    document.addEventListener('fullscreenchange', changed)
    document.addEventListener('webkitfullscreenchange', changed)
    this.renderFs()
  }

  fullscreen() {
    if (!this.fsWanted || this.fsPending || fsElement()) return
    this.fsPending = true
    requestFs().catch(() => {}).finally(() => { this.fsPending = false })
  }

  toggleFullscreen() {
    if (fsElement()) {
      this.fsWanted = false
      exitFs().catch(() => {})
    } else {
      this.fsWanted = true
      this.fullscreen()
    }
  }

  renderFs() {
    const on = !!fsElement()
    for (const b of document.querySelectorAll('.fs-btn')) {
      b.querySelector('use').setAttribute('href', on ? '#i-fs-exit' : '#i-fs')
      b.setAttribute('aria-pressed', on ? 'true' : 'false')
      b.setAttribute('aria-label', this.t('fullscreen'))
      b.title = this.t('fullscreen')
    }
  }

  setLang(lang) {
    if (lang !== 'pl' && lang !== 'en') return
    this.lang = lang
    store.set('pd-lang', lang)
    document.documentElement.lang = lang
    this.renderHome()
    this.applyText()
  }

  applyText() {
    for (const e of document.querySelectorAll('[data-t]')) e.textContent = this.t(e.dataset.t)
    for (const b of document.querySelectorAll('.lang button')) b.classList.toggle('on', b.dataset.lang === this.lang)
    this.renderOffline()
    this.renderFs()
  }

  // Short caption in the fixed-height bar: main sentence and a quieter hint.
  setCaption(box, main, hint) {
    box.textContent = ''
    const a = document.createElement('span')
    a.className = 'main'
    a.textContent = main
    box.append(a)
    if (hint) {
      const b = document.createElement('span')
      b.className = 'hint'
      b.textContent = hint
      box.append(' ', b)
    }
  }

  flash(msg, ms = 2500) {
    const f = document.getElementById('flash')
    f.textContent = msg
    f.classList.add('on')
    clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => f.classList.remove('on'), ms)
  }

  // --- home ---
  storySeconds(story) {
    let s = 0
    for (const id of story.scenes) {
      const sc = this.data.scenes[id]
      if (sc) s += (this.media(sc).duration || 4) + 1.2
    }
    return Math.round(s / 5) * 5
  }

  setThumb(img, path) {
    if (!path) { img.removeAttribute('src'); return }
    img.onerror = () => { img.onerror = null; img.src = path }
    img.src = this.thumb(path)
  }

  renderHome() {
    const d = this.data
    if (!d) return
    const progImg = document.querySelector('#tile-program img')
    const showTab = d.tabs.find((t) => t.id === 'move') || d.tabs[0]
    // the tiles show where a tab or a story ends up, not its empty first screen
    const lastScene = d.scenes[showTab?.scenes?.[showTab.scenes.length - 1]]
    this.setThumb(progImg, lastScene ? this.media(lastScene).end : this.tabStill(showTab))
    const box = document.getElementById('story-tiles')
    box.textContent = ''
    // story E's tile shows the short presentation instead (owner, 2026-11-03); E stays in the continuous show
    const shortAt = this.mat ? this.mat.items.findIndex((it) => it.group === 'short') : -1
    d.stories.forEach((st, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'tile tile-story'
      if (st.id === 'E' && shortAt >= 0) {
        const shortItems = this.mat.items.filter((it) => it.group === 'short')
        b.dataset.story = 'short'
        const img = document.createElement('img')
        img.alt = ''
        img.decoding = 'async'
        img.src = this.materials.file(shortItems[0].thumb)
        const label = document.createElement('span')
        label.className = 'tile-label'
        const letter = document.createElement('b')
        letter.className = 'letter'
        letter.textContent = 'P'
        const title = document.createElement('span')
        title.className = 'title'
        title.textContent = this.t('shortDeck')
        const dur = document.createElement('span')
        dur.className = 'dur'
        dur.textContent = this.plural(shortItems.length, this.t('matSlides'))
        label.append(letter, title, dur)
        b.append(img, label)
        b.addEventListener('click', () => this.show('materials', { item: shortAt }))
        box.append(b)
        return
      }
      b.dataset.story = st.id
      const img = document.createElement('img')
      img.alt = ''
      img.decoding = 'async'
      const sc = d.scenes[st.scenes[st.scenes.length - 1]]
      this.setThumb(img, sc ? this.media(sc).end : null)
      const label = document.createElement('span')
      label.className = 'tile-label'
      const letter = document.createElement('b')
      letter.className = 'letter'
      letter.textContent = st.id
      const title = document.createElement('span')
      title.className = 'title'
      title.textContent = this.text(st.title)
      const dur = document.createElement('span')
      dur.className = 'dur'
      dur.textContent = `${this.storySeconds(st)} ${this.t('seconds')}`
      label.append(letter, title, dur)
      b.append(img, label)
      b.addEventListener('click', () => this.show('story', { story: i, loop: false }))
      box.append(b)
    })
    this.setThumb(document.querySelector('#tile-film img'), 'media/film-poster.jpg')
  }

  // Polish counts: 1 slajd, 2-4 slajdy (not 12-14), 5 slajdów; English: 1 slide, 2 slides.
  plural(n, [one, few, many]) {
    if (n === 1) return `${n} ${one}`
    if (this.lang === 'pl' && n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return `${n} ${few}`
    return `${n} ${this.lang === 'pl' ? many : few}`
  }

  show(view, opts = {}) {
    if (this.view === 'program' && view !== 'program') this.program.close()
    if (this.view === 'story') this.story.close()
    if (this.view === 'film') this.closeFilm()
    if (this.view === 'materials' && view !== 'materials') this.materials.close()
    this.view = view
    this.root.dataset.view = view
    delete this.root.dataset.story
    if (view === 'program') this.program.open(opts.tab || 0)
    else if (view === 'story') this.story.open(opts.story || 0, !!opts.loop, !!opts.once)
    else if (view === 'film') this.openFilm()
    else if (view === 'materials') this.materials.open(opts.item)
    this.unlockVideo()
    this.updateState()
  }

  // --- film ---
  async openFilm() {
    const v = document.querySelector('#film video')
    const status = document.querySelector('#film .film-status')
    status.textContent = this.t('loading')
    try {
      const url = await this.clips.get('media/film.mp4')
      if (this.view !== 'film') return
      v.src = url
      status.textContent = ''
      await v.play().catch(() => {})
    } catch {
      status.textContent = this.t('clipError')
    }
  }

  closeFilm() {
    const v = document.querySelector('#film video')
    v.pause()
    v.removeAttribute('src')
    v.load()
    this.clips.keep([])
  }

  async shareBrochure() {
    const url = new URL(BROCHURE[this.lang], location.href).href
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Pallet Designer', url })
        return
      } catch (e) {
        if (e && e.name === 'AbortError') return
      }
    }
    window.open(url, '_blank', 'noopener')
  }

  // --- offline ---
  renderOffline() {
    const box = document.getElementById('offline')
    const o = this.offline
    box.dataset.state = o.state
    const txt = {
      idle: this.t('offCheck'),
      loading: `${this.t('offLoading')} ${o.pct} %`,
      ready: this.t('offReady'),
      update: this.t('offUpdate'),
      error: this.t('offError'),
      none: this.t('offNone'),
    }[o.state]
    box.querySelector('.txt').textContent = txt
    box.querySelector('.bar i').style.width = `${o.state === 'ready' || o.state === 'update' ? 100 : o.pct}%`
  }

  setOffline(state, pct = this.offline.pct) {
    this.offline = { state, pct }
    this.renderOffline()
  }

  // Fills the Cache Storage with every file of precache.json (the service worker answers from it).
  // A file whose hash did not change since the previous version is copied from the old cache. When the page itself
  // came from an older complete cache, the marker ends as "Nowa wersja – odśwież": a tap reloads into the new one.
  async offlineSetup() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) { this.setOffline('none', 0); return }
    if (this.offlineRunning) return
    this.offlineRunning = true
    try {
      this.setOffline('idle', 0)
      const reg = await navigator.serviceWorker.register('sw.js')
      const res = await fetch('precache.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`precache.json ${res.status}`)
      const pc = await res.json()
      const name = `pd-${pc.version}`
      const base = new URL('./', location.href)
      const url = (p) => new URL(p, base).href
      // the service worker answered this page from the newest complete cache (sw.js, lookup), if any
      let pageCache = null
      if (navigator.serviceWorker.controller) {
        for (const n of (await caches.keys()).filter((k) => k.startsWith('pd-')).reverse()) {
          if (await (await caches.open(n)).match(url('__complete'))) { pageCache = n; break }
        }
      }
      const cache = await caches.open(name)
      const olds = []
      for (const n of await caches.keys()) {
        if (!n.startsWith('pd-') || n === name) continue
        const c = await caches.open(n)
        const m = await c.match(url('__precache.json'))
        const list = m ? await m.json().catch(() => null) : null
        olds.push({ name: n, cache: c, hashes: new Map((list?.files || []).map((f) => [f.p, f.h])) })
      }
      const total = pc.files.reduce((a, f) => a + f.s, 0) || 1
      let done = 0
      const tick = () => this.setOffline('loading', Math.min(99, Math.floor((done / total) * 100)))
      tick()
      const queue = [...pc.files]
      const worker = async () => {
        while (queue.length) {
          const f = queue.shift()
          const key = url(f.p)
          if (await cache.match(key)) { done += f.s; tick(); continue }
          let copied = false
          for (const o of olds) {
            if (o.hashes.get(f.p) !== f.h) continue
            const r = await o.cache.match(key)
            if (r) { await cache.put(key, r); copied = true; break }
          }
          if (!copied) {
            const r = await fetch(key, { cache: 'reload' })
            if (!r.ok) throw new Error(`${f.p} ${r.status}`)
            await cache.put(key, r)
          }
          done += f.s
          tick()
        }
      }
      await Promise.all([worker(), worker(), worker(), worker()])
      const json = { headers: { 'Content-Type': 'application/json' } }
      await cache.put(url('precache.json'), new Response(JSON.stringify(pc), json))
      await cache.put(url('__precache.json'), new Response(JSON.stringify(pc), json))
      await cache.put(url('__complete'), new Response(pc.version))
      for (const o of olds) await caches.delete(o.name)
      try { await navigator.storage?.persist?.() } catch { /* ignore */ }
      await navigator.serviceWorker.ready
      if (!reg.active && !navigator.serviceWorker.controller) throw new Error('service worker')
      this.setOffline(pageCache && pageCache !== name ? 'update' : 'ready', 100)
    } catch (e) {
      console.warn('offline', e)
      this.setOffline('error')
    } finally {
      this.offlineRunning = false
    }
  }
}

const app = new App()
window.__demo = {
  get state() { return app.demoState() },
  get story() { return app.view === 'story' ? app.story.story?.id : null },
  get scene() { return app.view === 'story' ? app.story.k : null },
}
window.__pd = {
  app,
  test: testHooks,
  get view() { return app.view },
  get tab() { return app.program.tabs[app.program.idx]?.id },
  get tabIndex() { return app.program.idx },
  get zoom() { return app.view === 'story' ? app.story.panel?.s : app.view === 'materials' ? app.materials.panel?.s : app.program.panel?.s },
  get phase() { return app.view === 'story' ? app.story.phase : app.program.phase },
  get played() { return app.program.state[app.program.idx]?.played },
  get current() { return app.program.current() },
  get fullscreen() { return !!fsElement() },
  get storyScene() { return app.story.k },
  get storyId() { return app.story.story?.id },
  get auto() { return app.story.auto },
  get offline() { return app.offline.state },
  get item() { return app.view === 'materials' ? app.materials.idx : null },
  get still() {
    const p = app.view === 'story' ? app.story.panel : app.view === 'materials' ? app.materials.panel : app.program.panel
    return p?.stillUrl
  },
}
app.start()
