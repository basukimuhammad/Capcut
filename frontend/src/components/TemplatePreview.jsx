import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getTemplateInfo, requestTemplate, verifyHuman } from '../api'
import CaptchaSlider from './CaptchaSlider'
import AnimatedNumber, { formatCompact } from './AnimatedNumber'

function StatCell({ label, value }) {
  return (
    <div className="dl-stat">
      <AnimatedNumber value={Number(value || 0)} format={formatCompact} className="dl-stat-val" />
      <span className="dl-stat-lb">{label}</span>
    </div>
  )
}

export default function TemplatePreview({ t, info: cachedInfo, onClose }) {
  const [info, setInfo] = useState(cachedInfo)
  const [error, setError] = useState(null)
  const [play, setPlay] = useState(false)
  const [muted, setMuted] = useState(true)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const [reqMsg, setReqMsg] = useState('')
  const [needVerify, setNeedVerify] = useState(false)
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [verifyError, setVerifyError] = useState(null)
  const videoRef = useRef(null)

  useEffect(() => {
    if (cachedInfo) return
    let alive = true
    getTemplateInfo(t.id)
      .then((d) => alive && setInfo(d))
      .catch((e) => alive && setError(e.message))
    return () => { alive = false }
  }, [t.id, cachedInfo])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  const toggleSound = () => setMuted((m) => !m)

  const ask = async () => {
    try {
      await requestTemplate({
        id: t.id,
        title: info?.title || t.title || `Template ${t.id}`,
        cover: info?.cover_url || t.cover || '',
        author: info?.author?.name || t.author || '',
      })
      setSent(true)
      setReqMsg('Request terkirim ke owner — dicek secepatnya ✓')
      setTimeout(() => setReqMsg(''), 8000)
    } catch (e) {
      if (e.need_captcha) {
        setNeedVerify(true)
        setVerifyError(null)
        return
      }
      setReqMsg('Gagal kirim: ' + e.message)
    }
  }

  const onVerified = async () => {
    if (verifyLoading) return
    setVerifyLoading(true)
    setVerifyError(null)
    try {
      await verifyHuman()
      setNeedVerify(false)
      ask()
    } catch (e) {
      setVerifyError(e.message)
    } finally {
      setVerifyLoading(false)
    }
  }

  const stats = info?.stats || {}
  const cover = info?.cover_url || info?.cover_url_small || t.cover || null
  const videoUrl = info?.example_video?.url || null
  const title = info?.title || t.title || `Template ${t.id}`

  return (
    <AnimatePresence>
      {t && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            className="modal tpr-modal"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 14 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          >
            <button className="modal-close" onClick={onClose} aria-label="Tutup">✕</button>

            <div className="modal-media">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  muted={muted}
                  loop
                  playsInline
                  preload="metadata"
                  poster={cover}
                  src={videoUrl}
                  onClick={togglePlay}
                  onPlay={() => setPlay(true)}
                  onPause={() => setPlay(false)}
                />
              ) : cover ? (
                <img src={cover} alt={title} loading="lazy" />
              ) : (
                <div className="shimmer-block" style={{ minHeight: 160 }} />
              )}
              {info?.duration_text && <span className="chip chip-time">{info.duration_text}</span>}
            </div>

            <div className="modal-body">
              <span className="modal-kicker">Template · #{t.id}</span>
              <h2 className="modal-title">{title}</h2>

              {videoUrl && (
                <div className="tpr-controls" role="group" aria-label="Kontrol preview">
                  <button className="tpr-btn" onClick={togglePlay} aria-label={play ? 'Jeda preview' : 'Putar preview'}>
                    {play ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}><polygon points="6 3 20 12 6 21 6 3" /></svg>
                    )}
                    {play ? 'Jeda preview' : 'Putar preview'}
                  </button>
                  <button className="tpr-btn" onClick={toggleSound} aria-label={muted ? 'Nyalakan suara' : 'Bisukan suara'}>
                    {muted ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z" /><path d="M16 8v0a5 5 0 0 1 0 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3z" /><path d="M16 8l6 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M22 8L16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    )}
                    {muted ? 'Suara off' : 'Suara on'}
                  </button>
                </div>
              )}

              <div className="modal-author-row">
                {info?.author?.name && <span className="avatar avatar-lg">{info.author.name.charAt(0)}</span>}
                <div>
                  {info?.author?.name && <div className="modal-author">by {info.author.name}</div>}
                  <div className="modal-req">ID {t.id}</div>
                </div>
              </div>

              <div className="tpr-badges">
                {info?.ccweb_available != null && (
                  <span className={`tp-badge ${info.ccweb_available ? 'on' : 'off'}`}>
                    {info.ccweb_available ? '✓ Tersedia di CapCut Web' : '✕ Hanya aplikasi CapCut'}
                  </span>
                )}
                {info?.is_multi_lang != null && (
                  <span className="tp-badge neutral">{info.is_multi_lang ? 'Multi Bahasa' : 'Satu bahasa'}</span>
                )}
                <a className="tp-badge link" href={info?.url || `https://www.capcut.com/templates/${t.id}`} target="_blank" rel="noreferrer">Buka di CapCut ↗</a>
              </div>

              {error && !info && <div className="error-box flush">{error}</div>}

              {!info && !error && (
                <div className="dl-stats">
                  <div className="shimmer-block" style={{ height: 46, borderRadius: 10 }} />
                  <div className="shimmer-block" style={{ height: 46, borderRadius: 10 }} />
                </div>
              )}

              {info && (
                <>
                  <div className="dl-stats">
                    <StatCell label="Pemakaian" value={stats['Pemakaian (usage)']} />
                    <StatCell label="Tayangan" value={stats['Tayangan (play)']} />
                    <StatCell label="Like" value={stats['Like']} />
                    <StatCell label="Favorit" value={stats['Favorit']} />
                  </div>

                  <div className="modal-info">
                    {info.create_time && <div className="mi"><span>Dibuat</span><b>{info.create_time}</b></div>}
                    {info.duration_text && <div className="mi"><span>Durasi</span><b>{info.duration_text}</b></div>}
                    {info.fragment_count != null && <div className="mi"><span>Fragment</span><b>{info.fragment_count}</b></div>}
                    {info.author?.unique_id && <div className="mi"><span>Author</span><b>@{info.author.unique_id}</b></div>}
                  </div>

                  <button className="tp-json-toggle" onClick={() => setJsonOpen(!jsonOpen)}>
                    {jsonOpen ? '▾ Sembunyikan' : '▸ Lihat info mentah (JSON)'}
                  </button>
                  {jsonOpen && <pre className="tp-json"><code>{JSON.stringify(info, null, 2)}</code></pre>}
                </>
              )}

              <div className="modal-actions">
                {needVerify ? (
                  <div className="verify-box">
                    <div className="verify-title">🔐 Verifikasi dulu buat kirim request</div>
                    <CaptchaSlider disabled={verifyLoading} onVerified={onVerified} />
                    {verifyLoading && <p className="busy"><span className="spinner" /> Memverifikasi…</p>}
                    {verifyError && <div className="error-box flush">{verifyError}</div>}
                  </div>
                ) : info?.ccweb_available === false ? (
                  <button className="btn" disabled>
                    ✕ Hanya aplikasi CapCut — tak bisa dirender
                  </button>
                ) : info?.in_catalog ? (
                  <button className="btn" disabled>
                    ✓ Sudah ada di katalog GenCap
                  </button>
                ) : (
                  <button className="btn btn-primary grad-btn" onClick={ask} disabled={sent}>
                    {sent ? '✓ Terkirim ke Owner' : '✉ Minta ke Owner'}
                  </button>
                )}
              </div>
              {reqMsg && <p className="tp-msg">{reqMsg}</p>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}