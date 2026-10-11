import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { searchTemplates } from '../api'

export default function RequestTemplate({ onClose, onView }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (e) => {
    e?.preventDefault()
    const query = q.trim()
    if (!query || loading) return
    setLoading(true); setError(null)
    try {
      const list = await searchTemplates(query)
      setResults(list)
      setSearched(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <motion.div
        className="modal rq-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <div className="rq-head">
          <span className="tos-icon">🔍</span>
          <div>
            <h2 className="tos-title">Request Template Baru</h2>
            <span className="tos-sub">Cari di katalog CapCut, tap hasilnya untuk lihat info lengkap, lalu kirim request ke owner</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>

        <form className="rq-search" onSubmit={run}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari template… mis. 'love' / 'ramadhan'"
            maxLength={60}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !q.trim()}>
            {loading ? <><span className="spinner" /> Mencari…</> : 'Cari'}
          </button>
        </form>
        <p className="rq-hint">Hanya mendukung template dari hasil pencarian CapCut — ada jeda singkat antar pencarian. Klik hasil untuk lihat detail lengkap sebelum request.</p>

        {error && <div className="error-box flush">{error}</div>}

        {searched && !loading && results.length === 0 && (
          <div className="rq-empty">
            Tidak ada hasil untuk "{q}" — coba kata kunci lain (pakai bahasa Inggris, mis. love, birthday, ramadhan).
          </div>
        )}

        {results.length > 0 && (
          <div className="rq-results">
            {results.map((t) => (
              <button className="rq-item" key={t.id} onClick={() => onView(t)}>
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
        )}
      </motion.div>
    </div>
  )
}