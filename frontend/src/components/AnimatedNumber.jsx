import { useEffect, useRef, useState } from 'react'

export function formatNumber(n) {
  if (n == null || isNaN(n)) return '0'
  return Math.round(n).toLocaleString('en-US')
}

export function formatCompact(n) {
  if (n == null || isNaN(n)) return '0'
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}

export default function AnimatedNumber({ value = 0, from, duration = 1600, format = formatNumber, className = '' }) {
  const ref = useRef(null)
  const start = from != null ? from : 0
  const [display, setDisplay] = useState(start)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return
        started.current = true
        obs.disconnect()
        const delta = value - start
        const t0 = performance.now()
        const step = (t) => {
          const p = Math.min((t - t0) / duration, 1)
          const ease = 1 - Math.pow(1 - p, 3)
          setDisplay(start + delta * ease)
          if (p < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      },
      { threshold: 0.2 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [value, duration, start])

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  )
}