import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

function toSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function Hero({ loading, onRefresh }) {
  const [gif, setGif] = useState('/bg1.gif')

  useEffect(() => {
    const preload = (src) => {
      const img = new Image()
      img.src = src
    }
    preload('/bg1.gif')
    preload('/bg2.gif')
  }, [])

  return (
    <section className="hero">
      <div className="hero-orbs" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <span className="orb orb-3" />
      </div>
      <div className="hero-grid" aria-hidden="true" />

      <motion.div
        className="hero-content"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <span className="badge">
          <span className="pulse-dot" /> Auto CapCut Video Generator
        </span>
        <div className="hero-thumb-wrap" onMouseEnter={() => setGif('/bg2.gif')} onMouseLeave={() => setGif('/bg1.gif')}>
          <img className="hero-thumb" src={gif} alt="Preview animasi GenCap" loading="eager" decoding="async" />
        </div>
        <h1 className="hero-title">
          GenCap
        </h1>
        <p className="hero-sub">
          Pilih template viral, upload fotomu, biarkan GenCap
          <br className="hide-sm" /> menghasilkan video siap unggah — otomatis & cepat.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => toSection('templates')}>
            LIHAT TEMPLATE
          </button>
          <button className="btn btn-ghost" onClick={onRefresh} disabled={loading}>
            {loading ? 'MEMUAT…' : '↻ REFRESH'}
          </button>
        </div>
      </motion.div>
    </section>
  )
}