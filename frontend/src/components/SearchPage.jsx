import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { searchTemplates, fetchFyp, getHumanStatus, verifyHuman } from '../api'
import CaptchaSlider from './CaptchaSlider'
import TemplatePreview from './TemplatePreview'

const DAY=864e5
function cget(q){ try{const k='gencap:search:'+q.toLowerCase(); const x=JSON.parse(localStorage.getItem(k)); if(x&&x.exp>Date.now()) return x.v;}catch{} return null }
function cset(q,v){ try{const k='gencap:search:'+q.toLowerCase(); localStorage.setItem(k,JSON.stringify({v,exp:Date.now()+DAY}))}catch{} }
function cfypGet(p){ try{const k='gencap:fyp:'+p; const x=JSON.parse(localStorage.getItem(k)); if(x&&x.exp>Date.now()) return x.v;}catch{} return null }
function cfypSet(p,v){ try{const k='gencap:fyp:'+p; localStorage.setItem(k,JSON.stringify({v,exp:Date.now()+DAY}))}catch{} }


const PER_PAGE = 20

function pageList(total, cur) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const set = new Set([1, total, cur - 1, cur, cur + 1])
  return [...set].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
}

function Pagination({ page, totalPages, total, label, onChange }) {
  if (totalPages <= 1) return null
  const pages = pageList(totalPages, page)
  return (
    <div className="pagination">
      <button className="pg-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Prev</button>
      {pages.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && pages[i - 1] !== p - 1 && <span className="pg-dots">…</span>}
          <button className={`pg-btn ${p === page ? 'pg-on' : ''}`} onClick={() => onChange(p)}>{p}</button>
        </React.Fragment>
      ))}
      <button className="pg-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next ›</button>
      <span className="pg-info">{label} · halaman {page}/{totalPages} · {total} item</span>
    </div>
  )
}

export default function SearchPage({ onClose }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState(false)
  const [previewT, setPreviewT] = useState(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalHits, setTotalHits] = useState(0)

  const [fyp, setFyp] = useState([])
  const [fypLoading, setFypLoading] = useState(false)
  const [fypPage, setFypPage] = useState(1)
  const [fypTotalPages, setFypTotalPages] = useState(1)

  const [human, setHuman] = useState(null)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyError, setVerifyError] = useState(null)
  const [pendingSearch, setPendingSearch] = useState(false)

  const loadFyp = async (p = 1) => {
    const cached = cfypGet(p)
    if (cached) { setFyp(cached.templates||[]); setFypTotalPages(cached.total_pages||1); setFypPage(p); return }
    setFypLoading(true)
    try {
      const d = await fetchFyp({ page: p, per_page: PER_PAGE })
      cfypSet(p,d)
      setFyp(d.templates || [])
      setFypTotalPages(d.total_pages || 1)
      setFypPage(p)
    } catch (e) {
      if (e.need_captcha) setHuman(false)
      else setError('FYP dari akun gagal dimuat — coba lagi nanti.')
    } finally {
      setFypLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    getHumanStatus().then((h) => {
      if (!alive) return
      setHuman(!!h)
      if (h) loadFyp(1)
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onVerified = async () => {
    if (verifyLoading) return
    setVerifyLoading(true)
    setVerifyError(null)
    try {
      await verifyHuman()
      setHuman(true)
      loadFyp(1)
      if (pendingSearch && q.trim()) {
        setPendingSearch(false)
        doSearch(1)
      }
    } catch (e) {
      setVerifyError(e.message)
    } finally {
      setVerifyLoading(false)
    }
  }

  const doSearch = async (p = 1) => {
    const query = q.trim()
    if (!query || loading) return
    const cached = cget(query + '::' + p + '::' + PER_PAGE)
    if (cached) { setResults(cached.templates||[]); setTotalPages(cached.total_pages||1); setTotalHits(cached.total||0); setPage(p); setSearched(true); return }
    setLoading(true); setError(null)
    try {
      const d = await searchTemplates(query, { page: p, per_page: PER_PAGE })
      cset(query + '::' + p + '::' + PER_PAGE, d)
      setResults(d.templates || [])
      setTotalPages(d.total_pages || 1)
      setTotalHits(d.total || 0)
      setPage(p)
      setSearched(true)
    } catch (err) {
      if (err.need_captcha) {
        setHuman(false)
        setPendingSearch(true)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const run = (e) => {
    e?.preventDefault()
    if (!q.trim() || loading) return
    if (human === false) {
      setPendingSearch(true)
      setError(null)
      return
    }
    doSearch(1)
  }

  const verifyPanel = human === false && (
    <div className="verify-box">
      <div className="verify-title">🔐 Verifikasi manusia dulu</div>
      <p className="rq-hint">Biar web nggak diserang bot, geser slider ini dulu sebelum bisa cari template / lihat For You.</p>
      <CaptchaSlider disabled={verifyLoading} onVerified={onVerified} />
      {verifyLoading && <p className="busy"><span className="spinner" /> Memverifikasi…</p>}
      {verifyError && <div className="error-box flush">{verifyError}</div>}
      {pendingSearch && <p className="rq-hint">Carian "{q}" akan jalan otomatis setelah verifikasi.</p>}
    </div>
  )

  return (
    <motion.div
      className="dp sp"
      initial={{ x: '100%', opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="dp-nav">
        <span className="dp-logo">Gen<b>Cap</b> <span className="dp-logo-sub">/ Cari Template CapCut</span></span>
        <button className="dp-back" onClick={onClose}>← Kembali ke Web</button>
      </div>

      <div className="dp-wrap sp-wrap">
        <span className="dp-kicker">Temukan Template</span>
        <h1>Cari Template <span className="dp-g">di Katalog CapCut</span></h1>
        <p className="dp-sub">Ketuk hasil untuk lihat info lengkap, lalu minta owner menambahkan template ke katalog GenCap.</p>

        {verifyPanel}

        <form className="sp-search" onSubmit={run}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="CARI TEMPLATE… MIS. 'LOVE' / 'RAMADHAN'"
            maxLength={60}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || human === false || !q.trim()}>
            {loading ? <><span className="spinner" /> MENCARI…</> : 'CARI'}
          </button>
        </form>
        <p className="rq-hint sp-hint">Hanya mendukung template dari hasil pencarian CapCut — ada jeda singkat antar pencarian. Klik hasil untuk lihat detail lengkap sebelum request.</p>

        {error && <div className="error-box flush">{error}</div>}

        {!searched && !error && !verifyPanel && (
          <div className="sp-section">
            <h2 className="sp-h2">🔥 For You — dari akun CapCut</h2>
            <p className="rq-hint">Rekomendasi sesuai akun & region (via browser CapCut, bukan API). Klik untuk lihat detail lalu minta ke owner.</p>
            {fypLoading && <p className="busy"><span className="spinner" /> Memuat For You…</p>}
            {!fypLoading && fyp.length === 0 && !error && (
              <div className="rq-empty">Belum ada rekomendasi For You — coba cari lewat form di atas.</div>
            )}
            {fyp.length > 0 && (
              <div className="rq-results sp-results">
                {fyp.map((t) => (
                  <button className="rq-item" key={'fyp' + t.id} onClick={() => setPreviewT(t)}>
                    {t.cover
                      ? <img className="rq-cover" src={t.cover} alt="" loading="lazy" />
                      : <span className="rq-cover rq-nocover">№</span>}
                    <span className="rq-meta">
                      <span className="rq-title" title={t.title}>{t.title}</span>
                      <span className="rq-sub">
                        {t.author || '—'}
                        {t.usage_text ? ` · ${t.usage_text}× dipakai` : ''}
                        {t.duration_text ? ` · ${t.duration_text}` : ''}
                      </span>
                    </span>
                    <span className="rq-go">Detail →</span>
                  </button>
                ))}
              </div>
            )}
            <Pagination page={fypPage} totalPages={fypTotalPages} total={fypTotalPages > 1 ? fypTotalPages * PER_PAGE : fyp.length} label="For You" onChange={loadFyp} />
          </div>
        )}

        {searched && !loading && results.length === 0 && (
          <div className="rq-empty">Tidak ada hasil untuk "{q}" — coba kata kunci lain.</div>
        )}

        {results.length > 0 && (
          <>
            <div className="rq-results sp-results">
              {results.map((t) => (
                <button className="rq-item" key={t.id} onClick={() => setPreviewT(t)}>
                  {t.cover
                    ? <img className="rq-cover" src={t.cover} alt="" loading="lazy" />
                    : <span className="rq-cover rq-nocover">№</span>}
                  <span className="rq-meta">
                    <span className="rq-title" title={t.title}>{t.title}</span>
                    <span className="rq-sub">
                      {t.author || '—'}
                      {t.stats && t.stats.usage > 0 && ` · ${Number(t.stats.usage).toLocaleString('id')}× dipakai`}
                    </span>
                  </span>
                  <span className="rq-go">Detail →</span>
                </button>
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} total={totalHits} label={`Hasil "${q}"`} onChange={doSearch} />
          </>
        )}
      </div>

      {previewT && (
        <TemplatePreview t={previewT} info={null} onClose={() => setPreviewT(null)} />
      )}
    </motion.div>
  )
}