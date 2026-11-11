// 画卷: the week from /api/v3/calendar as a list by day (the phone layout of the web 画卷), the
// weekly brief, and every 叠墨 with its rule strategies; a tap applies one and saves to the cloud.
import { ensureLoaded, getState, commit, api, freshen } from '../../utils/store.js';
import { calendarItems, weekStart, weekRange, weeklyBrief, conflictKey, LAYER_LABEL } from '../../lib/calendar.js';
import { skipRoutineDate, updateEvent, updateTask, addAdjustment } from '../../lib/time-state.js';

const DAY = 86400000;
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const local = ms => new Date(ms + 8 * 3600000);
const clock = ms => local(ms).toISOString().slice(11, 16);
const monthDay = ms => `${local(ms).getUTCMonth() + 1}月${local(ms).getUTCDate()}日`;
const CONFLICT_LABEL = { routine_overlap: '底色相叠', temporary_routine_overlap: '点墨压在底色上', temporary_overlap: '两处点墨相叠',
  appointment_routine_overlap: '约定压在底色上', appointment_overlap: '约定与他事相叠', work_shortage: '留白不够落笔', overdue: '已过截止' };

Page({
  data: { loading: true, error: '', weekLabel: '', days: [], conflicts: [], brief: [], stats: [], note: '', undoLabel: '' },
  week: null,
  result: null,
  undo: null,

  async onShow() { await this.refresh(); },
  async onPullDownRefresh() { await this.refresh(); wx.stopPullDownRefresh(); },

  async refresh() {
    this.setData({ loading: true, error: '' });
    try {
      await ensureLoaded();
      await freshen();
      if (this.week === null) this.week = weekStart(Date.now());
      const { snapshot } = getState();
      this.result = await api('/api/v3/calendar', { snapshot, range: weekRange(this.week) });
      this.paint();
    } catch (error) {
      this.setData({ loading: false, error: error.message });
    }
  },

  paint() {
    const start = this.week;
    const now = Date.now();
    const items = calendarItems(this.result).filter(item => item.end > start && item.start < start + 7 * DAY);
    const days = WEEKDAYS.map((name, index) => {
      const dayStart = start + index * DAY;
      const dayEnd = dayStart + DAY;
      const rows = items.filter(item => item.type !== 'free' && item.end > dayStart && item.start < dayEnd)
        .sort((a, b) => a.start - b.start)
        .map(item => {
          const line = item.type === 'deadline' || item.type === 'start';
          const finish = Math.min(item.end, dayEnd);
          return { key: `${item.key || item.id}-${item.start}`, time: line ? clock(item.start) : `${clock(Math.max(item.start, dayStart))}–${finish === dayEnd ? '24:00' : clock(finish)}`,
            title: item.title, layer: item.type, layerName: LAYER_LABEL[item.type], conflict: Boolean(item.conflict) };
        });
      const free = items.filter(item => item.type === 'free' && item.end > dayStart && item.start < dayEnd)
        .reduce((sum, item) => sum + Math.min(item.end, dayEnd) - Math.max(item.start, dayStart), 0) / 3600000;
      return { label: `${monthDay(dayStart)} ${name}`, today: now >= dayStart && now < dayEnd, past: dayEnd <= now, rows, free: Number(free.toFixed(1)) };
    });
    const conflicts = this.result.conflicts.map(conflict => ({
      key: conflictKey(conflict), id: conflict.id, label: CONFLICT_LABEL[conflict.type] || '叠墨',
      when: conflict.start ? `${monthDay(Date.parse(conflict.start))}${conflict.minutes ? ` · ${conflict.minutes}分钟` : ''}` : '',
      advice: conflict.advice || conflict.reason || '',
      strategies: (conflict.strategies || []).map((strategy, index) => ({ index, label: strategy.label, detail: strategy.detail, recommended: Boolean(strategy.recommended) })),
    }));
    const count = type => items.filter(item => item.type === type).length;
    const freeHours = items.filter(item => item.type === 'free').reduce((sum, item) => sum + Math.min(item.end, start + 7 * DAY) - Math.max(item.start, start), 0) / 3600000;
    this.setData({
      loading: false,
      weekLabel: `${monthDay(start)} — ${monthDay(start + 6 * DAY)}`,
      days, conflicts,
      brief: weeklyBrief(items, start, now).map(line => line.replace(/<\/?b>/g, '')),
      stats: [[count('routine'), '底色'], [count('work') + count('appointment'), '落笔'], [count('temporary'), '点墨'], [count('deadline'), '截止'], [Number(freeHours.toFixed(1)), '时留白']],
      undoLabel: this.undo ? this.undo.label : '',
    });
  },

  shiftWeek(event) {
    const step = Number(event.currentTarget.dataset.step);
    this.week = step === 0 ? weekStart(Date.now()) : this.week + step * 7 * DAY;
    this.undo = null;
    this.refresh();
  },

  async applyStrategy(event) {
    const { conflict: conflictId, index } = event.currentTarget.dataset;
    const conflict = this.result.conflicts.find(item => item.id === conflictId);
    const strategy = conflict && conflict.strategies[index];
    if (!strategy) return;
    if (strategy.action === 'review') { wx.showToast({ title: '这一条需要到网页版的铺纸或笔墨里改', icon: 'none' }); return; }
    const { snapshot } = getState();
    const params = strategy.params;
    let next;
    try {
      if (strategy.action === 'skip_routine_date') next = skipRoutineDate(snapshot, params.routine_id, params.date);
      else if (strategy.action === 'cancel_event') next = updateEvent(snapshot, params.event_id, { status: 'cancelled' });
      else if (strategy.action === 'move_event') next = updateEvent(snapshot, params.event_id, { start_at: params.start_at, end_at: params.end_at });
      else if (strategy.action === 'update_task') next = updateTask(snapshot, params.task_id, params.patch);
      else if (strategy.action === 'add_free') next = addAdjustment(snapshot, { kind: 'add', start_at: params.start_at, end_at: params.end_at, note: params.note });
      else return;
    } catch (error) { wx.showToast({ title: `没能采用：${error.message}`, icon: 'none' }); return; }
    this.undo = { before: snapshot, label: strategy.label };
    wx.showLoading({ title: '正在重排' });
    try {
      await commit(next);
      if (strategy.action === 'skip_routine_date') this.draftNote(conflict, strategy);
      await this.refresh();
    } finally { wx.hideLoading(); }
  },

  // Skipping a class leaves one more step: a leave note to the teacher, drafted by the same rules.
  async draftNote(conflict, strategy) {
    const { snapshot } = getState();
    const located = item => item.layer === 'routine'
      ? (snapshot.routines.find(routine => routine.id === item.id.split('@')[0]) || {}).location || null
      : (snapshot.events.find(event => event.id === item.id) || {}).location || null;
    try {
      const result = await api('/api/v3/advise', {
        type: conflict.type, advice: (conflict.advice || '').slice(0, 300),
        items: conflict.items.slice(0, 2).map(item => ({ title: item.title, layer: item.layer, start: item.start || null, end: item.end || null, location: located(item) })),
        strategies: [{ action: strategy.action, label: strategy.label, detail: strategy.detail, recommended: true }],
      });
      if (result.note) this.setData({ note: result.note });
    } catch (error) { /* the plan is applied; the note is optional */ }
  },

  copyNote() {
    wx.setClipboardData({ data: this.data.note, success: () => wx.showToast({ title: '已复制，记得把【】换成你的信息', icon: 'none' }) });
  },
  closeNote() { this.setData({ note: '' }); },

  async undoStrategy() {
    if (!this.undo) return;
    const { before } = this.undo;
    this.undo = null;
    this.setData({ note: '' });
    await commit({ ...before, revision: getState().snapshot.revision + 1 });
    await this.refresh();
  },
});
