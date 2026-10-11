import React from 'react'
import { motion } from 'framer-motion'
import VideoPlayer from './VideoPlayer'

const STATUS = {
  queued: { label: 'Antri', cls: 'st-pending', live: true },
  processing: { label: 'Proses…', cls: 'st-work', live: true },
  completed: { label: 'Selesai', cls: 'st-done', live: false },
  failed: { label: 'Gagal', cls: 'st-fail', live: false },
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  return d
}

function cleanFile(id, f) {
  if (!f || typeof f !== 'string') return null
  if (/^\/api\/files\//.test(f) || /^https?:\/\//.test(f)) return f
  const base = f.split(/[\\/]/).pop()
  return '/api/files/' + id + '/' + base
}

export default function TaskList({ tasks, templates, onGoUpload }) {
  const tmplTitle = (id) => {
    const t = templates.find((x) => String(x.id) === String(id))
    return t ? t.title : `Template ${id}`
  }

  const done = tasks.filter((t) => t.status === 'completed')
  const active = tasks.filter((t) => STATUS[t.status]?.live)

  const last3 = done
    .slice()
    .sort((a, b) => new Date(b.created_at || b.createdAt) - new Date(a.created_at || a.createdAt))
    .slice(0, 3)

  const shown = [...active, ...last3]

  return (
    <motion.section
      id="tasks"
      className="section tasks-section"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6 }}
    >
      <div className="section-head">
        <span className="kicker">Daftar Task</span>
        <h2>Progress <span className="grad">Render</span></h2>
        <p className="section-sub">
          3 proses yang berhasil pada GenCap — render sukses terbaru tampil otomatis, update tanpa reload.
        </p>
      </div>

      {shown.length === 0 ? (
        <div className="tasks-empty">
          <p>Belum ada proses berhasil.</p>
          <button className="btn btn-primary" onClick={onGoUpload}>Generate Sekarang →</button>
        </div>
      ) : (
        <div className="task-list">
          {shown.map((t, i) => {
            const st = STATUS[t.status] || STATUS.queued
            const resultFile = cleanFile(t.id, t.result?.file || t.result?.download_url)
            return (
              <motion.div
                className="task-row"
                key={t.id}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-20px' }}
                transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.4 }}
              >
                <div className="task-main">
                  <span className={`task-state ${st.cls}`}>
                    {st.live ? <span className="spinner tiny" /> : t.status === 'completed' ? '✓' : t.status === 'failed' ? '✕' : null}
                  </span>
                  <div className="task-meta">
                    <div className="task-title" title={tmplTitle(t.template_id)}>{tmplTitle(t.template_id)}</div>
                    <div className="task-sub">
                      <span className={`badge-sm ${st.cls}`}>{st.label}</span>
                      <span className="task-id-short">#{String(t.id).slice(0, 8)}</span>
                      {fmtTime(t.created_at || t.createdAt) && <span>{fmtTime(t.created_at || t.createdAt)}</span>}
                    </div>
                    {t.error && <div className="task-error">{t.error}</div>}
                  </div>
                </div>

                <div className="task-side">
                  {t.status === 'completed' && resultFile ? (
                    <VideoPlayer src={resultFile} />
                  ) : (
                    <span className="task-hint">
                      {st.live ? 'Proses di server…' : 'ID: ' + t.id}
                    </span>
                  )}
                </div>
              </motion.div>
            )
          })}
        </div>
      )}
    </motion.section>
  )
}