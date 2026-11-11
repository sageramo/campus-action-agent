// One list per WeChat user, kept in the cloud (cloud function "sixu") with a local copy for speed.
// Every change goes through commit(): it updates the copy, then saves to the cloud with the revision
// this phone last saw, so a newer save from another phone is never overwritten silently.
import { createTimeSnapshot, serializeTimeSnapshot, parseTimeSnapshot, setReferenceTime } from '../lib/time-state.js';

const CACHE_KEY = 'sixu.list';
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
  wx.setStorageSync(CACHE_KEY, { text: serializeTimeSnapshot(state.snapshot), revision });
}

/** Signs in with WeChat and loads this user's list once per launch. */
export function ensureLoaded() {
  if (state.snapshot) return Promise.resolve(state);
  if (state.loading) return state.loading;
  state.loading = (async () => {
    const cached = wx.getStorageSync(CACHE_KEY);
    if (cached && cached.text) { try { adopt(cached.text, cached.revision); } catch (error) { /* the cloud copy decides */ } }
    state.profile = await call('login');
    const remote = await call('load');
    if (remote.text || !state.snapshot) adopt(remote.text, remote.revision);
    return state;
  })().finally(() => { state.loading = null; });
  return state.loading;
}

export const getState = () => state;

/** On a phone the week is planned from now: an old 起点 is moved forward to the current minute. */
export function freshen() {
  const now = Date.now();
  if (state.snapshot && Date.parse(state.snapshot.reference_time) < now - 3600000) return commit(setReferenceTime(state.snapshot, currentMinuteISO()));
  return Promise.resolve();
}

export async function commit(next) {
  state.snapshot = next;
  const text = serializeTimeSnapshot(next);
  wx.setStorageSync(CACHE_KEY, { text, revision: state.revision });
  const saved = await call('save', { text, baseRevision: state.revision });
  if (saved.conflict) {
    adopt(saved.text, saved.revision);
    wx.showToast({ title: '另一台设备改过，已载入云端最新', icon: 'none' });
    return false;
  }
  state.revision = saved.revision;
  wx.setStorageSync(CACHE_KEY, { text, revision: saved.revision });
  return true;
}

export async function setName(name) {
  state.profile = { ...(state.profile || {}), ...(await call('setName', { name })) };
  return state.profile;
}
