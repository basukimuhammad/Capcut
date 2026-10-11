import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { createTask, issueCaptcha } from '../api'
import CaptchaSlider from './CaptchaSlider'

const COOLDOWN_MS = 2 * 60 * 1000

export default function UploadSection({ selectedTemplate, onSelect, onGoTemplates, onTaskCreated }) {
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState({})
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [captchaToken, setCaptchaToken] = useState(null)
  const [captchaReady, setCaptchaReady] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const inputRef = useRef(null)

  const required = selectedTemplate ? Number(selectedTemplate.photos_required) || 1 : 1

  const now = Date.now()
  const cooldownLeft = cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const id = setInterval(() => forceTick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const resetCaptcha = useCallback(() => { setCaptchaToken(null); setCaptchaReady(false) }, [])

  const addFiles = useCallback((incoming) => {
    const imgs = incoming.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) { setError('Hanya file gambar (jpg, png, dll) yang diterima.'); return }
    setFiles((prev) => {
      const picked = [...prev, ...imgs].filter((f, i, arr) => arr.findIndex((x) => x.name === f.name) === i).slice(0, required)
      const map = {}
      picked.forEach((f) => { if (!previews[f.name]) map[f.name] = URL.createObjectURL(f) })
      if (Object.keys(map).length) setPreviews((pr) => ({ ...pr, ...map }))
      return picked
    })
    setError(null)
  }, [previews, required])

  const removeFile = useCallback((i) => {
    setPreviews((prev) => { const n = { ...prev }; delete n[files[i].name]; return n })
    setFiles((prev) => prev.filter((_, j) => j !== i))
  }, [files])

  const onSliderVerified = useCallback(async () => {
    if (captchaToken) return
    try {
      const token = await issueCaptcha('create')
      setCaptchaToken(token)
      setCaptchaReady(true)
      setError(null)
    } catch (e) {
      setError('Captcha gagal disiapkan: ' + e.message)
      setCaptchaReady(false)
      setCaptchaToken(null)
    }
  }, [captchaToken])

  const canSubmit = !!selectedTemplate && files.length === required && captchaReady && !busy && !cooldownLeft

  async function submit() {
    if (!canSubmit) return
    setBusy(true); setError(null)
    try {
      const task = await createTask(selectedTemplate.id, files, captchaToken)
      setFiles([])
      setPreviews((prev) => { Object.values(prev).forEach((u) => URL.revokeObjectURL(u)); return {} })
      resetCaptcha()
      setCooldownUntil(Date.now() + COOLDOWN_MS)
      onTaskCreated(task)
    } catch (e) {
      setError(e.message)
      if (e.retry_after || e.status === 429) {
        setCooldownUntil(Date.now() + (Number(e.retry_after) || 120) * 1000)
        resetCaptcha()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.section
      id="upload"
      className="section upload-section"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6 }}
    >
      <div className="section-head">
        <span className="kicker">Buat Video</span>
        <h2>Upload Foto → <span className="grad">Generate</span></h2>
        <p className="section-sub">
          Pilih template, upload {required} foto, geser verifikasi, lalu Generate. Ada cooldown 2 menit per generate (maks 3 request per IP) untuk kam Gencap.
        </p>
      </div>

      <div className="upload-card">
        {!selectedTemplate ? (
          <div className="upload-empty">
            <div className="upload-empty-icon">✦</div>
            <p>Belum ada template dipilih.</p>
            <button className="btn btn-primary" onClick={onGoTemplates}>Pilih Template →</button>
          </div>
        ) : (
          <>
            <div className="upload-tpl">
              <span className="upload-tpl-thumb"><span>№</span></span>
              <div className="upload-tpl-meta">
                <div className="upload-tpl-title">{selectedTemplate.title}</div>
                <div className="upload-tpl-fill">
                  {files.length}/{required} foto terisi
                  <span className="upload-tpl-bar"><i style={{ width: `${Math.min(100, (files.length / required) * 100)}%` }} /></span>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>Ganti Template</button>
            </div>

            <div
              className={`dropzone ${drag ? 'dropzone-drag' : ''} ${files.length >= required ? 'dropzone-full' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)) }}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }}
              />
              <div className="dropzone-icon">↥</div>
              <div className="dropzone-text"><b>Seret foto ke sini</b> atau <u>klik untuk memilih</u></div>
              <div className="dropzone-sub">Butuh {required} foto · format jpg/png/webp</div>
            </div>

            {files.length > 0 && (
              <div className="preview-grid">
                {files.map((f, i) => (
                  <div className="preview" key={`${f.name}-${i}`}>
                    <img src={previews[f.name]} alt={f.name} />
                    {i === 0 && <span className="preview-first">Foto 1</span>}
                    <button className="preview-x" onClick={(e) => { e.stopPropagation(); removeFile(i) }} aria-label="Hapus">✕</button>
                  </div>
                ))}
              </div>
            )}

            {cooldownLeft > 0 && (
              <div className="cooldown">
                ⏱ Cooldown aktif — tunggu <b>{cooldownLeft} detik</b> sebelum generate lagi.
              </div>
            )}

            {captchaReady && (
              <div className="cap-ready">Humans only — verifikasi selesai, silakan generate.</div>
            )}

            <CaptchaSlider
              disabled={!!cooldownLeft || busy || !(files.length === required)}
              onVerified={onSliderVerified}
              onReset={resetCaptcha}
            />

            {error && <div className="error-box flush">{error}</div>}

            <div className="upload-actions">
              <button
                className="btn btn-primary btn-lg grad-btn"
                disabled={!canSubmit}
                onClick={submit}
              >
                {busy ? (<><span className="spinner" /> Memproses…</>) : (<>⚡ {files.length === required ? 'Generate' : `Generate (${files.length}/${required})`}</>)}
              </button>
            </div>
          </>
        )}
      </div>
    </motion.section>
  )
}