import React from 'react'
import { motion } from 'framer-motion'

const BASE = 'https://cc.septia.eu.cc'

function C({ children }) { return <code>{children}</code> }

export default function DocsPage({ onClose }) {
  return (
    <motion.div
      className="dp"
      initial={{ x: '100%', opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
    >
      <div className="dp-nav">
        <span className="dp-logo">Gen<b>Cap</b> <span className="dp-logo-sub">/ API Docs</span></span>
        <button className="dp-back" onClick={onClose}>← Kembali ke Web</button>
      </div>

      <div className="dp-wrap">
        <span className="dp-kicker">Public API</span>
        <h1>Dokumentasi <span className="dp-g">API GenCap</span></h1>
        <p className="dp-sub">Automasi render video template CapCut. Akses API dengan kunci (unlimited) atau tanpa kunci (limit global 6 req/menit untuk GET).</p>

        <div className="dp-block">
          <h3>Dasar URL</h3>
          <p className="dp-muted">Semua endpoint dimulai dari</p>
          <pre><code><span className="dp-s">{BASE}</span>/v1/...</code></pre>
        </div>

        <div className="dp-block">
          <h3>Autentikasi — API Key</h3>
          <p className="dp-muted">Kirim header <code>x-api-key</code> (atau query <code>?api_key=</code>). Dengan key: <b className="dp-ok">unlimited</b>. Tanpa key: GET dibatasi <b className="dp-warn">6 request/menit</b> (global, dipakai bareng), generate <b className="dp-warn">2 request/menit</b> global.</p>
          <pre><code><span className="dp-k">x-api-key:</span> gc_xxxxxxxxxxxxxxxxxxxx</code></pre>
          <div className="dp-note">Belum punya key? Hubungi owner — buat di halaman admin <a href="/admin">/admin</a>.</div>
        </div>

        <div className="dp-block">
          <h3>Endpoint</h3>
          <div className="dp-eps">
            <div>
              <p className="dp-ep"><span className="dp-tag get">GET</span><code className="dp-path">/v1/templates</code></p>
              <p className="dp-muted">Daftar semua template yang tersedia (termasuk jumlah foto yang dibutuhkan).</p>
              <pre><code><span className="dp-m"># contoh</span>
<span className="dp-k">curl</span> https://cc.septia.eu.cc/v1/templates \
  -H <span className="dp-s">"x-api-key: gc_..."</span></code></pre>
            </div>
            <div>
              <p className="dp-ep"><span className="dp-tag get">GET</span><code className="dp-path">/v1/templates/:id/info</code></p>
              <p className="dp-muted">Info detail template: cover, author, statistik, dan URL video contoh.</p>
            </div>
            <div>
              <p className="dp-ep"><span className="dp-tag get">GET</span><code className="dp-path">/v1/tasks/:id</code></p>
              <p className="dp-muted">Cek status task render (<code>queued</code> / <code>processing</code> / <code>completed</code> / <code>failed</code>) + tautan video hasil.</p>
            </div>
            <div>
              <p className="dp-ep"><span className="dp-tag post">POST</span><code className="dp-path">/v1/tasks</code></p>
              <p className="dp-muted"><b className="dp-warn">Wajib API key</b> untuk unlimited. Tanpa key tetap boleh, tapi dibatasi <b className="dp-warn">2 generate/menit</b> global. Multipart form-data:</p>
              <pre><code><span className="dp-k">curl</span> -X POST https://cc.septia.eu.cc/v1/tasks \
  -H <span className="dp-s">"x-api-key: gc_..."</span> \
  -F <span className="dp-s">template_id=7405909526802615570</span> \
  -F <span className="dp-s">images=@foto1.jpg</span> \
  -F <span className="dp-s">images=@foto2.jpg</span> \
  -F <span className="dp-s">images=@foto3.jpg</span></code></pre>
              <p className="dp-muted" style={{ marginTop: 6 }}>Balasan <code>201</code> berisi <code>task.id</code>; gunakan id itu untuk polling <code>GET /v1/tasks/:id</code>.</p>
            </div>
          </div>
        </div>

        <div className="dp-block">
          <h3>Limit & Kebijakan</h3>
          <table>
            <tbody>
              <tr><th>Konteks</th><th>Limit</th></tr>
              <tr><td>GET tanpa API key</td><td><b className="dp-warn">6 request/menit</b> — global (dipakai bareng semua user)</td></tr>
              <tr><td>GET/POST dengan API key</td><td><b className="dp-ok">Unlimited</b></td></tr>
              <tr><td>POST tanpa API key</td><td><b className="dp-warn">2 generate/menit</b> — global (dipakai bareng semua user)</td></tr>
            </tbody>
          </table>
          <p className="dp-micro">Jika limit tercapai server membalas <code>429</code> dengan header <code>Retry-After</code> (detik). Response error selalu berbentuk <code>{"{\"error\": \"...\"}"}</code>.</p>
        </div>

        <div className="dp-block">
          <h3>Contoh JavaScript</h3>
          <pre><code>{'// fetch semua template'}
<span className="dp-k">const</span> res = <span className="dp-k">await</span> fetch(<span className="dp-s">'https://cc.septia.eu.cc/v1/templates'</span>, {'{'}
  headers: {'{'} <span className="dp-s">'x-api-key'</span>: <span className="dp-s">'gc_...'</span> {'}'}
{'}'});
<span className="dp-k">const</span> data = <span className="dp-k">await</span> res.json();
console.log(data.templates);</code></pre>
        </div>

        <p className="dp-foot">GenCap API · © {new Date().getFullYear()}</p>
      </div>
    </motion.div>
  )
}