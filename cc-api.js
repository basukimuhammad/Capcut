const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST = 'https://edit-api-sg.capcut.com';
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const PF = '7';
const APP_VER = '5.8.0';
const TDID = '';

function buildCookie() {
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'storage_state.json'), 'utf8'));
  return state.cookies
    .filter(c => !c.expires || c.expires > Date.now() / 1000)
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

function baseHeaders(path) {
  const deviceTime = Math.floor(Date.now() / 1000);
  const sign = md5(`9e2c|${path.slice(-7)}|${PF}|${APP_VER}|${deviceTime}|${TDID}|11ac`).toLowerCase();
  return {
    'accept': 'application/json, text/plain, */*',
    'app-sdk-version': '48.0.0',
    'appid': '348188',
    'appvr': APP_VER,
    'content-type': 'application/json',
    'cookie': buildCookie(),
    'device-time': String(deviceTime),
    'did': '7670116360126662152',
    'lan': 'en',
    'loc': 'sg',
    'origin': 'https://www.capcut.com',
    'pf': PF,
    'referer': 'https://www.capcut.com/',
    'sign': sign,
    'sign-ver': '1',
    'store-country-code': 'id',
    'store-country-code-src': 'uid',
    'tdid': TDID,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };
}

async function request(path, body) {
  const r = await fetch(HOST + path, {
    method: 'POST',
    headers: baseHeaders(path),
    body: JSON.stringify(body),
  });
  return r.text();
}

async function listTasks(status) {
  const t = await request('/lv/v1/common_task/list', { status, cursor: 0, count: 100 });
  let j;
  try { j = JSON.parse(t); } catch (e) { return []; }
  const tasks = (j.data && j.data.common_tasks) || [];
  return tasks.map(x => ({
    id: x.base_info.id,
    name: x.base_info.video_name,
    status: x.base_info.status,
    create_time: x.base_info.create_time,
  }));
}

async function deleteTask(taskId) {
  const t = await request('/lv/v1/common_task/delete', { task_id: String(taskId), source: 'web' });
  return t.includes('"ret":"0"');
}

module.exports = { listTasks, deleteTask };
