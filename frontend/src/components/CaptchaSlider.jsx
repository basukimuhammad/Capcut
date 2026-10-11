import React, { useRef, useState } from 'react'

const HANDLE = 44
const MARGIN = 4

export default function CaptchaSlider({ disabled, onVerified, onReset }) {
  const [x, setX] = useState(0)
  const [done, setDone] = useState(false)
  const drag = useRef(false)
  const trackRef = useRef(null)

  const usable = () => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return 0
    return r.width - HANDLE - MARGIN * 2
  }

  const move = (clientX) => {
    if (!drag.current) return
    const r = trackRef.current?.getBoundingClientRect()
    if (!r) return
    const max = r.width - HANDLE - MARGIN * 2
    let left = clientX - r.left - HANDLE / 2
    left = Math.max(0, Math.min(max, left))
    setX(left)
    if (left >= max) {
      drag.current = false
      setX(max)
      setDone(true)
      onVerified && onVerified()
    }
  }

  const release = () => {
    if (drag.current) {
      drag.current = false
      setX(0)
    }
  }

  const reset = () => {
    setX(0)
    setDone(false)
  }

  if (done) {
    return (
      <div className="cap-slider cap-done">
        <span className="cap-check">✓</span> Terverifikasi manusia
        <button className="cap-reset" onClick={() => { reset(); onReset && onReset() }}>ulang</button>
      </div>
    )
  }

  return (
    <div
      className={`cap-slider ${disabled ? 'cap-disabled' : ''}`}
      ref={trackRef}
    >
      <span className="cap-track" style={{ width: MARGIN + x }} />
      <span
        className="cap-handle"
        style={{ left: MARGIN + x }}
        onPointerDown={(e) => {
          if (disabled) return
          drag.current = true
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
        }}
        onPointerMove={(e) => move(e.clientX)}
        onPointerUp={release}
        onPointerCancel={release}
      >
        {x > 0 ? '→' : '››'}
      </span>
      <span className="cap-label">Geser ke kanan untuk verifikasi manusia</span>
    </div>
  )
}