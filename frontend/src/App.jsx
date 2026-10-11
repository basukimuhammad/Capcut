import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getTemplates, fetchAllInfos, getTasks, getTask } from './api'
import Hero from './components/Hero'
import StatsBar from './components/StatsBar'
import Ticker from './components/Ticker'
import TemplateCard from './components/TemplateCard'
import Modal from './components/Modal'
import UploadSection from './components/UploadSection'
import TaskList from './components/TaskList'
import TosModal from './components/TosModal'
import { lazy, Suspense } from "react"
const DocsPage = lazy(() => import("./components/DocsPage"))
const SearchPage = lazy(() => import("./components/SearchPage"))

const STORAGE_KEY = "gencap.tasks.v1"

const DAY=864e5
function cacheGet(k){ try{const x=JSON.parse(localStorage.getItem(k)); if(x&&x.exp>Date.now()) return x.v;}catch{} return null }
function cacheSet(k,v){ try{localStorage.setItem(k,JSON.stringify({v,exp:Date.now()+DAY}))}catch{} }
function cacheClearExpired(){ try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(!k||(!k.startsWith('gencap:search:')&&!k.startsWith('gencap:fyp:'))) continue; const x=localStorage.getItem(k); try{const j=JSON.parse(x); if(j.exp<=Date.now()) localStorage.removeItem(k);}catch{localStorage.removeItem(k);} } }catch{} }


function loadTasks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] } catch { return [] }
}

function skeletonGrid() {
  return Array.from({ length: 8 }, (_, i) => (
    <div className="card skeleton-card" key={`sk-${i}`}>
      <div className="card-media"><div className="shimmer-block" /></div>
      <div className="card-body">
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </div>
    </div>
  ))
}

const LIVE_STATUS = new Set(['queued', 'processing'])

export default function App() {
  const [templates, setTemplates] = useState([])
  const [infos, setInfos] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [tasks, setTasks] = useState(loadTasks)
  const [uploadTpl, setUploadTpl] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [visibleCount, setVisibleCount] = useState(5)
  const [page, setPage] = useState(null)
  const [theme,setTheme]=useState(()=>localStorage.getItem('gencap:theme')||'dark'); useEffect(()=>{document.documentElement.setAttribute('data-theme',theme); localStorage.setItem('gencap:theme',theme);},[theme]);
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null)
    try {
      const list = await getTemplates()
      setTemplates(list)
      const infoMap = await fetchAllInfos()
      setInfos(infoMap)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)) }, [tasks])

  const mergeTasks = useCallback((incoming) => {
    setTasks((prev) => {
      const map = new Map(prev.map((t) => [t.id, t]))
      for (const t of incoming) map.set(t.id, { ...t })
      return Array.from(map.values())
    })
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const snapshot = tasksRef.current
      for (const t of snapshot) {
        if (!LIVE_STATUS.has(t.status)) continue
        try {
          const task = await getTask(t.id)
          if (alive) mergeTasks([task])
        } catch { /* server boleh aja 404 — biarkan tampil */ }
      }
    }
    const first = async () => {
      try {
        const serverTasks = await getTasks()
        if (alive) mergeTasks(loadTasks().concat(serverTasks))
      } catch { /* offline */ }
    }
    first()
    tick()
    const id = setInterval(tick, 3000)
    return () => { alive = false; clearInterval(id) }
  }, [mergeTasks])

  const sums = React.useMemo(() => {
    let usage = 0, play = 0, like = 0
    for (const info of Object.values(infos)) {
      const s = info?.stats || {}
      usage += Number(s['Pemakaian (usage)'] || 0)
      play += Number(s['Tayangan (play)'] || 0)
      like += Number(s['Like'] || 0)
    }
    return { templates: templates.length, usage, play, like }
  }, [infos, templates])

  const openModal = useCallback((template, info) => setSelected({ template, info }), [])

  const goGenerate = useCallback((template) => {
    setSelected(null)
    setUploadTpl(template)
    setTimeout(() => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [])

  const scrollToId = useCallback((id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const go = useCallback((id) => {
    setMenuOpen(false)
    scrollToId(id)
  }, [scrollToId])

  const goTop = useCallback(() => {
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const makeTask = useCallback((task) => {
    mergeTasks([task])
    setTimeout(() => document.getElementById('tasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [mergeTasks])

  const pathOf = useCallback((p) => {
    if (!p) return '/'
    if (p.kind === 'docs') return '/docs'
    if (p.kind === 'search') return '/search'
    return '/'
  }, [])

  const syncFromPath = useCallback(() => {
    const st = history.state
    if (st && st.gc === true) setPage({ ...st })
    else if (window.location.pathname === '/search') setPage({ kind: 'search' })
    else setPage(null)
  }, [])

  useEffect(() => {
    syncFromPath()
    const onPop = () => syncFromPath()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [syncFromPath])

  const navigate = useCallback((p) => {
    const st = { gc: true, ...p }
    history.pushState(st, '', pathOf(p))
    setPage({ ...st })
  }, [pathOf])

  const goBack = useCallback(() => {
    if (history.state && history.state.gc === true) history.back()
    else {
      history.replaceState(null, '', '/')
      setPage(null)
    }
  }, [])

  useEffect(() => {
    if (!page) return
    const onKey = (e) => { if (e.key === 'Escape') goBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page, goBack])

  const openDocs = useCallback(() => { setMenuOpen(false); navigate({ kind: 'docs' }) }, [navigate])

  const openSearch = useCallback(() => { setMenuOpen(false); navigate({ kind: 'search' }) }, [navigate])

  const activeCount = tasks.filter((t) => LIVE_STATUS.has(t.status)).length

  return (
    <div id="gc">
      <header className="nav">
        <button className="logo" onClick={goTop} aria-label="Kembali ke atas">
          <img className="logo-img" src="/favicon.svg" alt="GenCap" /> Gen<span className="grad">Cap</span>
        </button>
        <div className="nav-links">
          <button className="nav-link" onClick={() => scrollToId('templates')}>Template</button>
          <button className="nav-link" onClick={openSearch}>Cari Template</button>
          <button className="nav-link" onClick={() => scrollToId('upload')}>Buat Video</button>
          <button className="nav-link nav-task" onClick={() => scrollToId('tasks')}>
            Task{activeCount > 0 && <span className="nav-badge">{activeCount}</span>}
          </button>
        </div>
        <div className="nav-right">
          <button className="nav-link nav-doc" onClick={openDocs}>API Docs</button>
          <span className={`api-dot ${error ? 'down' : 'up'}`} /> {error ? 'API Error' : 'API Online'}
        </div>
        <button
          className="theme-btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label={theme === 'dark' ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'}
          title={theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button
          className={`hamburger ${menuOpen ? 'open' : ''}`}
          aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>

        <div className={`mobile-menu ${menuOpen ? 'open' : ''}`}>
          <button className="nav-link" onClick={() => go('templates')}>Template</button>
          <button className="nav-link" onClick={() => { setMenuOpen(false); navigate({ kind: 'search' }) }}>Cari Template</button>
          <button className="nav-link" onClick={() => go('upload')}>Buat Video</button>
          <button className="nav-link nav-task" onClick={() => go('tasks')}>
            Task{activeCount > 0 && <span className="nav-badge">{activeCount}</span>}
          </button>
          <button class="nav-link" onClick={()=>{setTheme(t=>t==='dark'?'light':'dark'); setMenuOpen(false)}}>{theme==='dark'?'🌙 Mode Gelap':'☀️ Mode Terang'}</button>
          <button className="nav-link nav-doc" onClick={openDocs}>API Docs</button>
          <span className="mm-status">
            <span className={`api-dot ${error ? 'down' : 'up'}`} /> {error ? 'API Error' : 'API Online'}
          </span>
          <div className="mm-contact">
            <span className="mm-contact-label">Kontak / Komunitas</span>
            <a href="https://wa.me/6285181730629" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
              Chat WA Owner
            </a>
            <a href="https://t.me/putzyy2" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)}>
              Telegram @putzyy2
            </a>
          </div>
        </div>
      </header>

      <div className="promo-banner">
        <p>
          Ingin beli <b>key premium</b>? Silakan chat owner via{' '}
          <a href="https://t.me/putzyy2" target="_blank" rel="noreferrer">Telegram @putzyy2</a> atau{' '}
          <a href="https://wa.me/6285181730629" target="_blank" rel="noreferrer">Chat WA Owner</a>
        </p>
      </div>

      <Hero loading={loading} onRefresh={() => load(true)} />

      <StatsBar stats={sums} ready={!loading && !error} />

      <Ticker items={templates} />

      <main id="templates" className="section">
        <div className="section-head">
          <span className="kicker">Katalog</span>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            Pilih Template <span className="grad">Muat Fasilitas</span>
          </motion.h2>
          <p className="section-sub">{templates.length} template siap pakai — klik untuk detail & buat video.</p>
          <div className="section-actions">
            <button className="btn btn-ghost btn-sm" onClick={openSearch}>
              + Minta Template Baru
            </button>
          </div>
        </div>

        {error && (
          <div className="error-box">
            <p>Gagal memuat data: {error}</p>
            <button className="btn btn-ghost" onClick={() => load(true)}>Coba lagi</button>
          </div>
        )}

        <div className="grid">
          {loading
            ? skeletonGrid()
            : templates.slice(0, visibleCount).map((t, i) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  info={infos[t.id]}
                  index={i}
                  onOpen={openModal}
                  onGenerate={goGenerate}
                />
              ))}
        </div>

        {!loading && templates.length > visibleCount && (
          <div className="load-more">
            <button className="btn btn-ghost" onClick={() => setVisibleCount((v) => Math.min(templates.length, v + 5))}>
              Lihat lebih banyak ({templates.length - visibleCount} lagi)
            </button>
          </div>
        )}
      </main>

      <UploadSection
        selectedTemplate={uploadTpl}
        onSelect={setUploadTpl}
        onGoTemplates={() => scrollToId('templates')}
        onTaskCreated={makeTask}
      />

      <TaskList tasks={tasks} templates={templates} onGoUpload={() => scrollToId('upload')} />

      <footer className="footer">
        <div><img className="logo-img sm" src="/favicon.svg" alt="G" /> <b>Gen<span className="grad">Cap</span></b> by Ryan</div>
        <div className="footer-thanks">
          Thanks to{' '}
          <a href="https://fgsi.space" target="_blank" rel="noreferrer">fgsi dev</a>
          {' · '}
          <a href="https://termai.cc" target="_blank" rel="noreferrer">rifza</a>
        </div>
        <div className="footer-sub">© {new Date().getFullYear()} GenCap. All Rights Reserved.</div>
      </footer>

      <Modal item={selected} onClose={() => setSelected(null)} onGenerate={goGenerate} />

      <TosModal />

      <AnimatePresence>
        <Suspense fallback={null}>
          {page && page.kind === 'docs' && (
            <DocsPage key="docs" onClose={goBack} />
          )}
          {page && page.kind === 'search' && (
            <SearchPage key="search" onClose={goBack} />
          )}
        </Suspense>
      </AnimatePresence>
    </div>
  )
}