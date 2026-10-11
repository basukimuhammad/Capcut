import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import AnimatedNumber, { formatCompact } from './AnimatedNumber'

function StatCell({ label, value }) {
  return (
    <div className="dl-stat">
      <AnimatedNumber value={Number(value || 0)} format={formatCompact} className="dl-stat-val" />
      <span className="dl-stat-lb">{label}</span>
    </div>
  )
}

export default function Modal({ item, onClose, onGenerate }) {
  const [muted, setMuted] = useState(true)
  const videoRef = useRef(null)
  const triedUnmute = useRef(false)

  useEffect(() => {
    triedUnmute.current = false
    if (!item) { setMuted(true); return }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [item, onClose])

  const handlePlay = () => {
    const v = videoRef.current
    if (!v || !v.muted || triedUnmute.current) return
    triedUnmute.current = true
    try {
      v.muted = false
      v.volume = 1
      setMuted(false)
    } catch (e) { v.muted = true }
  }

  const toggleSound = () => {
    const v = videoRef.current
    if (!v) return
    const next = v.muted
    v.muted = !next
    setMuted(!next)
    v.volume = 1
  }

  return (
    <AnimatePresence>
      {item && (() => {
        const { template, info } = item
        const stats = info?.stats || {}
        const duration = info?.duration_text || null
        const cover = info?.cover_url || info?.cover_url_small || null
        const videoUrl = info?.example_video?.url || null

        return (
          <motion.div
            className="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              className="modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.92, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              <button className="modal-close" onClick={onClose} aria-label="Tutup">✕</button>

              <div className="modal-media">
                {videoUrl ? (
                  <video
                    key={videoUrl}
                    ref={videoRef}
                    src={videoUrl}
                    poster={cover}
                    autoPlay
                    loop
                    muted={muted}
                    playsInline
                    controls={false}
                    preload="metadata"
                    onPlaying={handlePlay}
                  />
                ) : cover ? (
                  <img src={cover} alt={template.title} loading="lazy" />
                ) : (
                  <div className="shimmer-block" style={{ minHeight: 200 }} />
                )}
                <div className="modal-media-shade" />
                {duration && <span className="chip chip-time">{duration}</span>}
                <span className="chip chip-live"><span className="pulse-dot" /> Preview</span>
                {videoUrl && (
                  <button
                    className={`sound-btn ${muted ? 'muted' : 'on'}`}
                    onClick={toggleSound}
                    aria-label={muted ? 'Hidupkan suara' : 'Matikan suara'}
                    title={muted ? 'Hidupkan suara' : 'Matikan suara'}
                  >
                    {muted ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
                    )}
                  </button>
                )}
              </div>

              <div className="modal-body">
                <span className="modal-kicker">Template · #{template.id}</span>
                <h2 className="modal-title">{template.title}</h2>
                <div className="modal-author-row">
                  {info?.author?.name && (
                    <span className="avatar avatar-lg">{info.author.name.charAt(0)}</span>
                  )}
                  <div>
                    {info?.author?.name && <div className="modal-author">by {info.author.name}</div>}
                    <div className="modal-req">{template.photos_required} foto · {template.id}</div>
                  </div>
                </div>
                {info?.author?.description && <p className="modal-desc">{info.author.description}</p>}

                <div className="dl-stats">
                  <StatCell label="Pemakaian" value={stats['Pemakaian (usage)']} />
                  <StatCell label="Tayangan" value={stats['Tayangan (play)']} />
                  <StatCell label="Like" value={stats['Like']} />
                  <StatCell label="Favorit" value={stats['Favorit']} />
                  <StatCell label="Share" value={stats['Share']} />
                  <StatCell label="Komentar" value={stats['Komentar']} />
                </div>

                <div className="modal-info">
                  {info?.create_time && <div className="mi"><span>Dibuat</span><b>{info.create_time}</b></div>}
                  {info?.duration_text && <div className="mi"><span>Durasi</span><b>{info.duration_text}</b></div>}
                  {info?.fragment_count != null && <div className="mi"><span>Fragment</span><b>{info.fragment_count}</b></div>}
                  {info?.is_multi_lang != null && <div className="mi"><span>Multi Bahasa</span><b>{info.is_multi_lang ? 'Ya' : 'Tidak'}</b></div>}
                </div>

                <div className="modal-actions">
                  {template.ccweb_available === false ? (
                    <button className="btn" disabled>✕ App-only — tak bisa Generate</button>
                  ) : (
                    <button className="btn btn-primary grad-btn" onClick={() => onGenerate(template)}>
                      ⚡ Generate
                    </button>
                  )}
                  <a className="btn btn-ghost" href={info?.url || `https://www.capcut.com/templates/${template.id}`} target="_blank" rel="noreferrer">
                    Buka di CapCut
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )
      })()}
    </AnimatePresence>
  )
}