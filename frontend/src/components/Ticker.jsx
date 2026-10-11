import React from 'react'

export default function Ticker({ items }) {
  if (!items || !items.length) return null
  const dup = [...items, ...items]
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-track">
        {dup.map((t, i) => (
          <span className="ticker-item" key={i}>
            <span className="ticker-dot" /> {t.title}
          </span>
        ))}
      </div>
    </div>
  )
}