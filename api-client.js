/*
 * api-client.js — client https://cc.septia.eu.cc (tanpa API key)
 * Hanya: edit template, daftar template, info template.
 */

const BASE = 'https://cc.septia.eu.cc';

/** Request JSON ke API. timeout 60s, retry 2x untuk error jaringan/5xx. */
async function req(path, opt = {}) {
  const { method = 'GET', body, query, timeout = 60000, retries = 2 } = opt;

  const qs = query
    ? '?' + new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString()
    : '';

  const url = path.startsWith('http') ? path : BASE + path + qs;
  let lastErr;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status < 500) break;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Daftar template katalog */
export const listTemplates = () => req('/api/templates');

/** Info satu template. refresh=true → scrape ulang dari CapCut */
export const getTemplateInfo = (id, { refresh = false } = {}) =>
  req(`/api/template-info/${id}`, { query: refresh ? { refresh: 1 } : undefined });

/** Edit template di katalog: title &/atau photos_required */
export async function editTemplate(id, patch = {}) {
  const body = {};
  if (patch.title !== undefined) body.title = String(patch.title);
  if (patch.photos_required !== undefined) {
    const n = parseInt(patch.photos_required, 10);
    if (!Number.isFinite(n) || n < 1) throw new Error('photos_required harus angka >= 1');
    body.photos_required = n;
  }
  if (!Object.keys(body).length) throw new Error('tidak ada field yang diubah');

  return req(`/api/templates/${id}`, { method: 'PATCH', body });
}

export { BASE, req };
