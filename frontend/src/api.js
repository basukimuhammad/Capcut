const BASE = ''

async function json(url, opts) {
  const r = await fetch(BASE + url, opts)
  if (!r.ok) {
    let msg = 'HTTP ' + r.status
    let needCaptcha = false
    try {
      const d = await r.json()
      msg = d.error || msg
      needCaptcha = !!d.need_captcha
    } catch {}
    const e = new Error(msg)
    e.need_captcha = needCaptcha
    e.status = r.status
    throw e
  }
  return r.json()
}

export async function getTemplates() {
  const d = await json('/api/templates')
  return d.templates || []
}

export async function getTemplateInfo(id, { refresh = false } = {}) {
  const d = await json(`/api/template-info/${id}${refresh ? '?refresh=1' : ''}`)
  return d.template
}

export async function fetchAllInfos() {
  const d = await json('/api/template-info')
  return d.templates || {}
}

export async function createTask(templateId, files, captchaToken) {
  const fd = new FormData()
  fd.append('template_id', String(templateId))
  files.forEach((f) => fd.append('images', f, f.name || 'img'))
  if (captchaToken) fd.append('captcha_token', captchaToken)
  const r = await fetch(BASE + '/api/tasks', { method: 'POST', body: fd })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const e = new Error(data.error || 'HTTP ' + r.status)
    e.retry_after = data.retry_after
    e.status = r.status
    throw e
  }
  return data.task
}

export async function issueCaptcha(action = 'create') {
  const r = await fetch(BASE + '/api/captcha', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status)
  return d.token
}

export async function getHumanStatus() {
  try {
    const d = await json('/api/verify/human')
    return !!d.human
  } catch {
    return false
  }
}

export async function verifyHuman() {
  const token = await issueCaptcha('human')
  const d = await json('/api/verify/human', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  return !!d.ok
}

export async function getTask(id) {
  const d = await json(`/api/tasks/${id}`)
  return d.task
}

export async function getTasks() {
  const d = await json('/api/tasks')
  return d.tasks || []
}

export async function searchTemplates(query, { page = 1, per_page = 20, count = 100, captcha_token } = {}) {
  const d = await json('/api/search-templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, page, per_page, count, captcha_token }),
  })
  return d
}

export async function fetchFyp({ page = 1, per_page = 20, count = 120, captcha_token } = {}) {
  const d = await json(`/api/fyp?page=${page}&per_page=${per_page}&count=${count}${captcha_token ? `&captcha_token=${encodeURIComponent(captcha_token)}` : ''}`)
  return d
}

export async function requestTemplate(template) {
  const d = await json('/api/template-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ template }),
  })
  return d
}