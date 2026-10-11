import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const CONSENT_KEY = 'gencap.consent.v1'

export function hasConsent() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONSENT_KEY))
    return !!raw && raw.ok === true
  } catch {
    return false
  }
}

export function setConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ ok: true, ts: Date.now() }))
  } catch {}
}

export default function TosModal() {
  const [show, setShow] = useState(!hasConsent())
  const [checked, setChecked] = useState(false)

  const agree = () => {
    if (!checked) return
    setConsent()
    setShow(false)
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="overlay tos-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="modal tos-modal"
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <div className="tos-head">
              <span className="tos-icon">📜</span>
              <div>
                <h2 className="tos-title">Aturan Pakai GenCap</h2>
                <span className="tos-sub">Baca dulu sebelum mulai generate</span>
              </div>
            </div>

            <ul className="tos-list">
              <li><b>Dilarang konten 18+/porno:</b> jangan upload foto atau generate video berisi konten dewasa, vulgar, atau merendahkan.</li>
              <li><b>Dilarang konten SARA, kekerasan & ancaman:</b> apapun yang melanggar hukum atau menyakiti orang lain.</li>
              <li><b>Jangan pakai milik orang lain</b> (foto orang tanpa izin, watermark, merk, dsb.) untuk hal tak pantas.</li>
              <li><b>Gunakan secukupnya:</b> ada limit per IP (3 generate / 2 menit) — jangan spam, biar server tetap adil.</li>
              <li>GenCap <b>tidak menyimpan</b> foto hasil upload; semua video dapat dihapus sewaktu-waktu.</li>
            </ul>

            <label className="tos-check">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>Saya sudah membaca, mengerti, dan menyetujui aturan di atas.</span>
            </label>

            <button className="btn btn-primary grad-btn tos-btn" disabled={!checked} onClick={agree}>
              Setuju & Lanjutkan →
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}