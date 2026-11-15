import { ensureLoaded, getState, commit, api } from '../../utils/store.js';
import { addImported, isPersonal, setDailyWindow } from '../../lib/time-state.js';
import { agendaReply, isConversation } from '../../lib/agenda.js';

const DEFAULT_WINDOW = [...Array(5).fill({ start: '08:00', end: '23:00' }), ...Array(2).fill({ start: '09:00', end: '23:00' })];
const MODES = ['默认', '模型聊天'];

Page({
  data: { text: '', busy: false, turns: [], error: '', mode: 0, modes: MODES, anchor: '' },
  lastTaskId: null,
  history: null,

  onLoad(query) {
    if (query && query.text) {
      try { this.setData({ text: decodeURIComponent(query.text) }); }
      catch (error) { this.setData({ text: query.text }); }
    }
    this.history = [];
  },

  onShow() {
    const app = getApp();
    if (app.agendaDraft && !this.data.text.trim() && !this.data.busy) this.setData({ text: app.agendaDraft });
    app.agendaDraft = null;
  },
  onInput(event) { this.setData({ text: event.detail.value }); },
  onMode(event) { this.setData({ mode: Number(event.detail.value) }); },
  suggest(event) { this.setData({ text: event.currentTarget.dataset.text }); },

  pasteClipboard() {
    wx.getClipboardData({
      success: ({ data }) => {
        const text = (data || '').trim();
        if (text && !this.data.busy) this.setData({ text: this.data.text.trim() ? `${this.data.text.trim()}\n\n${text}` : text });
      },
    });
  },

  async save(next) {
    if (!await commit(next)) throw new Error('清单在另一台设备上更新了，请重试。');
  },

  async send() {
    const text = this.data.text.trim();
    if (!text || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await ensureLoaded();
      const { snapshot } = getState();
      let reply = this.data.mode === 1 ? null : await agendaReply(text, { snapshot, lastTaskId: this.lastTaskId, calculate: body => api('/api/v3/calendar', body) });
      if (snapshot !== getState().snapshot) throw new Error('清单刚刚有变化，请再发送一次。');
      if (reply?.next) await this.save(reply.next);
      if (!reply && this.data.mode === 1) {
        if ([...text].length > 2000) throw new Error('聊天消息每次最多 2000 字。');
        const messages = [...this.history.slice(-8), { role: 'user', text }];
        const { reply: answer } = await api('/api/v3/chat', { mode: 'model', messages });
        this.history = [...messages.slice(-7), { role: 'assistant', text: answer }];
        reply = { text: answer };
      }
      if (!reply && isConversation(text)) reply = { text: '这句我还接不住。可以问本周空档，或选「模型聊天」聊别的。' };
      if (!reply) reply = await this.importMessage(snapshot, text);
      const turns = [...this.data.turns, { text, reply: reply.text, action: reply.action || '', week: reply.week ?? null, id: Date.now() }].slice(-12);
      this.setData({ text: '', turns, anchor: '' }, () => this.setData({ anchor: 'end' }));
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },

  async importMessage(snapshot, text) {
    const imported = await api('/api/v3/extract', { text, reference_date: null, mode: 'rules' });
    if (snapshot !== getState().snapshot) throw new Error('清单刚刚有变化，请再发送一次。');
    if (!imported.events.length && !imported.tasks.length) return { text: '还没有识别出事项。试试「提醒我今天写实验报告，30分钟」。' };
    const sources = new Set(snapshot.sources.filter(source => source.text === text).map(source => source.id));
    const same = (item, list, when) => list.some(saved => sources.has(saved.source_id) && saved.title === item.title && saved[when] === item[when]);
    if (sources.size && imported.tasks.every(item => same(item, snapshot.tasks, 'deadline_at'))
      && imported.events.every(item => same(item, snapshot.events, 'start_at'))) throw new Error('这条内容已经记过了。');
    let next = addImported(snapshot, imported);
    const defaulted = !next.daily_window;
    if (defaulted) next = setDailyWindow(next, DEFAULT_WINDOW);
    await this.save(next);
    const personal = imported.tasks.filter(isPersonal);
    this.lastTaskId = personal.length === 1 && imported.tasks.length === 1 && !imported.events.length ? personal[0].id : null;
    const names = [...imported.events, ...imported.tasks].slice(0, 5).map(item => `「${item.title}」`);
    const open = imported.events.filter(item => !item.start_at || !item.end_at).length;
    const pending = imported.tasks.filter(item => !item.deadline_at || !item.estimate_minutes).length + open;
    const follow = this.lastTaskId && personal[0].estimate_minutes === null ? '这件事要多久？可以直接回“30分钟”。' : '';
    const warnings = (imported.warnings || []).slice(0, 2).join(' ');
    return { text: `已记下 ${names.join('、')}${imported.events.length + imported.tasks.length > 5 ? ' 等' : ''}。${pending ? `有 ${pending} 项还需补时间或用时。` : ''}${follow}${warnings ? ' ' + warnings : ''}${defaulted ? '暂用默认作息，去画卷可调整。' : ''}`, action: open ? 'events' : pending && personal.length ? 'tasks' : 'calendar' };
  },

  toCalendar(event) {
    const { action, week } = event.currentTarget.dataset;
    getApp().agendaTarget = { action, week };
    wx.switchTab({ url: '/pages/calendar/index' });
  },
});
