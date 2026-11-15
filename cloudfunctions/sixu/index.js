// 司序小程序的唯一云函数。身份只认微信给的 OPENID（用户无需注册、无需密码），
// 每个人一份清单，存在 snapshots 集合里、以 OPENID 为文档 id；小程序端不直接读写数据库。
// 四层计算、通知提取等仍由司序后端完成：云函数在服务器端转发，不受小程序“合法域名”限制。
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const API = process.env.SIXU_API || 'https://campus-action-agent-back.onrender.com';
const MAX_LIST_BYTES = 5 * 1024 * 1024;
const NAME_MAX = 20;
// Only these back-end paths are forwarded; model modes need the server's access code (set
// SIXU_ACCESS in the cloud function's environment variables) and are refused without it.
const PATHS = new Set(['/api/health', '/api/v3/calendar', '/api/v3/extract', '/api/v3/estimate-end', '/api/v3/advise', '/api/v3/chat']);

async function ensureCollections() {
  for (const name of ['users', 'snapshots']) {
    try { await db.createCollection(name); } catch (error) { /* already exists */ }
  }
}

async function getDoc(collection, id) {
  const { data } = await db.collection(collection).where({ _id: id }).limit(1).get();
  return data[0] || null;
}

function forward(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API);
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {};
    if (body && body.mode === 'model') {
      if (!process.env.SIXU_ACCESS) return reject(new Error('小程序还没开通模型功能，请先用规则模式。'));
      headers['X-Sixu-Access'] = process.env.SIXU_ACCESS;
      headers.Origin = process.env.SIXU_ORIGIN || 'https://sageramo.github.io';
    }
    const request = https.request(url, { method: data ? 'POST' : 'GET', headers, timeout: 55000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (error) { return reject(new Error(`计算服务没有返回可读的数据（HTTP ${response.statusCode}）`)); }
        if (response.statusCode >= 400) return reject(Object.assign(new Error(parsed.error || `计算服务返回 HTTP ${response.statusCode}`), { code: parsed.code }));
        resolve(parsed);
      });
    });
    request.on('timeout', () => request.destroy(new Error('计算服务正在醒来或超时，请稍后再试。')));
    request.on('error', reject);
    if (data) request.write(data);
    request.end();
  });
}

const actions = {
  // 微信登录：没有档案就建一个；名字由用户自己取。
  async login(openid) {
    await ensureCollections();
    let user = await getDoc('users', openid);
    if (!user) {
      user = { name: '', created_at: db.serverDate() };
      await db.collection('users').doc(openid).set({ data: user });
      user = await getDoc('users', openid);
    }
    return { name: user.name || '', created_at: user.created_at || null };
  },

  async setName(openid, { name }) {
    const value = typeof name === 'string' ? name.trim() : '';
    if (!value || [...value].length > NAME_MAX) throw new Error(`名字需为1到${NAME_MAX}个字`);
    await db.collection('users').doc(openid).update({ data: { name: value } });
    return { name: value };
  },

  async load(openid) {
    const doc = await getDoc('snapshots', openid);
    return doc ? { text: doc.text, revision: doc.revision, saved_at: doc.saved_at } : { text: null, revision: 0 };
  },

  // 保存整份清单；baseRevision 是这台设备上次读到的版本，云端更新过就拒绝覆盖。
  async save(openid, { text, baseRevision }) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_LIST_BYTES) throw new Error('清单过大，请先在网页版导出备份并拆分。');
    try { JSON.parse(text); } catch (error) { throw new Error('清单不是有效的 JSON'); }
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error('清单版本号无效');
    const snapshots = db.collection('snapshots');
    const data = { text, revision: baseRevision + 1, saved_at: db.serverDate() };
    if (baseRevision === 0) {
      try {
        await snapshots.add({ data: { _id: openid, ...data } });
        return { conflict: false, revision: 1 };
      } catch (error) {
        const current = await getDoc('snapshots', openid);
        if (!current) throw error;
        return { conflict: true, text: current.text, revision: current.revision };
      }
    }
    const saved = await snapshots.where({ _id: openid, revision: baseRevision }).update({ data });
    if (saved.stats.updated === 1) return { conflict: false, revision: data.revision };
    const current = await getDoc('snapshots', openid);
    return { conflict: true, text: current ? current.text : null, revision: current ? current.revision : 0 };
  },

  async api(openid, { path, body }) {
    if (!PATHS.has(path)) throw new Error('不支持的计算请求');
    return forward(path, body);
  },
};

exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: '没有拿到微信身份，请在微信里打开小程序。' };
  const handler = actions[event && event.action];
  if (!handler) return { ok: false, error: '未知操作' };
  try {
    return { ok: true, data: await handler(OPENID, event.data || {}) };
  } catch (error) {
    return { ok: false, error: error.message || String(error), code: error.code };
  }
};
