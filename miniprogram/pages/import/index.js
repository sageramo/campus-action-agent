// 研墨: paste a notice (or take it from the clipboard), rules extraction on the server, and the
// items join this user's list in the cloud. Without a 作息 yet, the usual one is used and said so.
import { ensureLoaded, getState, commit, api } from '../../utils/store.js';
import { addImported, setDailyWindow } from '../../lib/time-state.js';

const DEFAULT_WINDOW = [...Array(5).fill({ start: '08:00', end: '23:00' }), ...Array(2).fill({ start: '09:00', end: '23:00' })];

Page({
  data: { text: '', busy: false, summary: '', error: '' },

  onLoad(query) {
    // 司序链接 opened inside WeChat can carry the notice the same way as the web: ?text=…
    if (query && query.text) this.setData({ text: decodeURIComponent(query.text) });
  },
  onInput(event) { this.setData({ text: event.detail.value }); },

  pasteClipboard() {
    wx.getClipboardData({
      success: ({ data }) => {
        const text = (data || '').trim();
        if (!text) { wx.showToast({ title: '剪贴板里没有文字', icon: 'none' }); return; }
        this.setData({ text: this.data.text.trim() ? `${this.data.text.trim()}\n\n${text}` : text });
      },
    });
  },

  async importNotice() {
    const text = this.data.text.trim();
    if (!text) { wx.showToast({ title: '先粘贴通知原文', icon: 'none' }); return; }
    this.setData({ busy: true, error: '', summary: '' });
    try {
      await ensureLoaded();
      const { snapshot } = getState();
      if (snapshot.sources.some(source => source.text === text)) throw new Error('这份通知已经导入过了。');
      const imported = await api('/api/v3/extract', { text, reference_date: null, mode: 'rules' });
      let next = addImported(snapshot, imported);
      const defaulted = !next.daily_window;
      if (defaulted) next = setDailyWindow(next, DEFAULT_WINDOW);
      await commit(next);
      const parts = [];
      if (imported.events.length) parts.push(`${imported.events.length} 处点墨`);
      if (imported.tasks.length) parts.push(`${imported.tasks.length} 件截止之事`);
      const open = imported.events.filter(event => !event.end_at).length;
      this.setData({
        text: '',
        summary: `已加入 ${parts.join('、') || '0 项'}。${open ? `其中 ${open} 处点墨只写了开始，结束时间先记作待书。` : ''}${defaulted ? '还没定作息，先按每天 08:00–23:00（周末 09:00 起）算留白。' : ''}`,
      });
    } catch (error) {
      this.setData({ error: `导入未完成：${error.message}` });
    } finally {
      this.setData({ busy: false });
    }
  },

  toCalendar() { wx.switchTab({ url: '/pages/calendar/index' }); },
});
