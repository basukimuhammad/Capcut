import React from 'react'
import { motion } from 'framer-motion'
import AnimatedNumber, { formatCompact, formatNumber } from './AnimatedNumber'

const items = [
  { key: 'templates', label: 'Template', icon: '◈' },
  { key: 'usage', label: 'Total Pemakaian', icon: '✦', compact: true },
  { key: 'play', label: 'Total Tayangan', icon: '▶', compact: true },
  { key: 'like', label: 'Total Like', icon: '♥', compact: true },
]

export default function StatsBar({ stats = {}, ready = false, animKey = 'root' }) {
  return (
    <section className="stats-wrap">
      <div className="stats">
        {items.map((it, i) => {
          const val = stats[it.key] ?? 0
          const from = Math.round(Math.max(val, 1) * 1.6 + 3500)
          return (
            <motion.div
              key={it.key}
              className="stat"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.12, duration: 0.5, ease: 'easeOut' }}
            >
              <span className="stat-icon">{it.icon}</span>
              {ready && val > 0 ? (
                <AnimatedNumber
                  value={val}
                  from={from}
                  format={it.compact ? formatCompact : formatNumber}
                  className="stat-value"
                  duration={1700}
                />
              ) : (
                <span className="stat-value">{ready ? '0' : '—'}</span>
              )}
              <span className="stat-label">{it.label}</span>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}