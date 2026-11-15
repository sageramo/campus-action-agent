// Load the signed-in user’s cloud list once. Update the in-memory copy only after a save is acknowledged.
import { createTimeSnapshot, serializeTimeSnapshot, parseTimeSnapshot, setReferenceTime } from '../lib/time-state.js';

const state = { snapshot: null, revision: 0, profile: null, loading: null };

export const currentMinuteISO = () => new Date(Math.ceil(Date.now() / 60000) * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function call(action, data = {}) {
  let result;
  try {
    ({ result } = await wx.cloud.callFunction({ name: 'sixu', data: { action, data } }));
  } catch (error) {
    throw new Error(`连接云端失败：${error.errMsg || error.message}`);
  }
  if (!result || !result.ok) throw Object.assign(new Error((result && result.error) || '云端没有返回结果'), { code: result && result.code });
  return result.data;
}
export const api = (path, body) => call('api', { path, body });

function adopt(text, revision) {
  state.snapshot = text ? parseTimeSnapshot(text) : createTimeSnapshot({ referenceTime: currentMinuteISO() });
  state.revision = revision;
}

/** Signs in with WeChat and loads this user's list once per launch. */
export function ensureLoaded() {
  if (state.snapshot) return Promise.resolve(state);
  if (state.loading) return state.loading;
  state.loading = (async () => {
    state.profile = await call('login');
    const remote = await call('load');
    adopt(remote.text, remote.revision);
    return state;
  })().finally(() => { state.loading = null; });
  return state.loading;
}

export const getState = () => state;

let saving = false;
export async function commit(next) {
  if (saving) throw new Error('正在保存另一处修改，请稍后重试。');
  const text = serializeTimeSnapshot(next);
  saving = true;
  try {
    const saved = await call('save', { text, baseRevision: state.revision });
    adopt(saved.conflict ? saved.text : text, saved.revision);
    if (saved.conflict) wx.showToast({ title: '另一台设备改过，已载入云端最新', icon: 'none' });
    return !saved.conflict;
  } finally { saving = false; }
}

export async function setName(name) {
  state.profile = { ...(state.profile || {}), ...(await call('setName', { name })) };
  return state.profile;
}
