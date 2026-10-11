import React, { useRef, useState } from 'react'

function fmt(s) {
  if (!isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export default function VideoPlayer({ src }) {
  const videoRef = useRef(null)
  const barRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  const seek = (e) => {
    const v = videoRef.current
    const bar = barRef.current
    if (!v || !bar || !v.duration) return
    const frac = (e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth
    const t = Math.max(0, Math.min(v.duration, frac * v.duration))
    v.currentTime = t
    setProgress(t)
  }

  return (
    <div className="vp">
      <video
        ref={videoRef}
        className="vp-video"
        src={src}
        preload="metadata"
        playsInline
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      {!playing && (
        <button className="vp-play" onClick={toggle} aria-label="Putar video">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
        </button>
      )}
      <div className="vp-bar">
        <button className="vp-btn" onClick={toggle} aria-label={playing ? 'Jeda' : 'Putar'}>
          {playing ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <div className="vp-time">{fmt(progress)} / {fmt(duration)}</div>
        <div className="vp-progress" ref={barRef} onClick={seek}>
          <i style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }} />
        </div>
        <a className="vp-btn vp-dl" href={src} download aria-label="Unduh video">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M5 10l7 6 7-6M4 21h16" /></svg>
        </a>
      </div>
    </div>
  )
}