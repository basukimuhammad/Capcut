import React from 'react'
import { motion } from 'framer-motion'
import AnimatedNumber, { formatCompact } from './AnimatedNumber'

export default function TemplateCard({ template, info, index, onOpen, onGenerate }) {
  const cover = info?.cover_url || info?.cover_url_small || null
  const stats = info?.stats || {}
  const duration = info?.duration_text || null
  const authorName = info?.author?.name || null
  const appOnly = template.ccweb_available === false

  return (
    <motion.article
      className="card"
      onClick={() => onOpen(template, info)}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ delay: (index % 4) * 0.08, duration: 0.55, ease: 'easeOut' }}
      whileHover={{ y: -6 }}
    >
      <div className="card-media">
        {cover ? (
          <img src={cover} alt={template.title} loading="lazy" />
        ) : (
          <div className="shimmer-block" />
        )}
        <div className="card-media-shade" />
        <span className="chip chip-index">№ {String(index + 1).padStart(2, '0')}</span>
        {appOnly && <span className="chip chip-app">app-only</span>}
        {duration && <span className="chip chip-time">{duration}</span>}
        <span className="card-play" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" /></svg>
        </span>
      </div>

      <div className="card-body">
        <h3 className="card-title" title={template.title}>{template.title}</h3>

        <div className="card-meta">
          <span className="avatar">{authorName ? authorName.charAt(0) : 'G'}</span>
          <div>
            <div className="card-author">{authorName ? `by ${authorName}` : 'Template'}</div>
            <div className="card-req">{template.photos_required} foto · #{template.id.slice(-6)}</div>
          </div>
        </div>

        {!info ? (
          <div className="stat-skeleton-row">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <div className="skeleton-line short" />
          </div>
        ) : (
          <div className="card-stats">
            <div className="card-stat">
              <span className="stat-val"><AnimatedNumber value={Number(stats['Pemakaian (usage)'] || 0)} format={formatCompact} /></span>
              <span className="stat-lb">Pemakaian</span>
            </div>
            <div className="card-stat">
              <span className="stat-val"><AnimatedNumber value={Number(stats['Tayangan (play)'] || 0)} format={formatCompact} /></span>
              <span className="stat-lb">Tayangan</span>
            </div>
            <div className="card-stat">
              <span className="stat-val"><AnimatedNumber value={Number(stats['Like'] || 0)} format={formatCompact} /></span>
              <span className="stat-lb">Like</span>
            </div>
          </div>
        )}
      </div>

      <div className="card-cta">
        <button className="subtle-btn" onClick={(e) => { e.stopPropagation(); onOpen(template, info) }}>
          Detail <span className="arrow">→</span>
        </button>
        <button
          className={`btn btn-generate${appOnly ? ' btn-dim' : ''}`}
          disabled={appOnly}
          onClick={(e) => { e.stopPropagation(); if (!appOnly) onGenerate(template) }}
        >
          {appOnly ? 'App-only' : 'Generate'}
        </button>
      </div>
    </motion.article>
  )
}