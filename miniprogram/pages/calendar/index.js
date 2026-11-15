// 画卷: the week from /api/v3/calendar as a list by day (the phone layout of the web 画卷), the
// weekly brief, and every 叠墨 with its rule strategies; a tap applies one and saves to the cloud.
import { ensureLoaded, getState, commit, api } from '../../utils/store.js';
import { calendarItems, weekStart, weekRange, weeklyBrief, remainingCapacity, minutesLabel, conflictKey, LAYER_LABEL } from '../../lib/calendar.js';
import { skipRoutineDate, updateEvent, updateTask, addAdjustment, addPersonalTask, isPersonal, personalDay, setPersonalDay, setTaskDeadline, setDailyWindow } from '../../lib/time-state.js';

const DAY = 86400000;
const localDay = ms => local(ms).toISOString().slice(0, 10);
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const local = ms => new Date(ms + 8 * 3600000);
const clock = ms => local(ms).toISOString().slice(11, 16);
const timeParts = value => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? { day: localDay(ms), time: clock(ms) } : { day: '', time: '' };
};
const dateTime = ({ day, time }, label) => {
  if (!day && !time) return null;
  if (!day || !time) throw new Error(`请为${label}同时选择日期和时间。`);
  return `${day}T${time}:00+08:00`;
};
const monthDay = ms => `${local(ms).getUTCMonth() + 1}月${local(ms).getUTCDate()}日`;
const CONFLICT_LABEL = { routine_overlap: '底色相叠', temporary_routine_overlap: '点墨压在底色上', temporary_overlap: '两处点墨相叠',
  appointment_routine_overlap: '约定压在底色上', appointment_overlap: '约定与他事相叠', work_shortage: '留白不够落笔', overdue: '已过截止' };

Page({
  data: { loading: true, error: '', weekLabel: '', days: [], conflicts: [], brief: [], stats: [], note: '', undoLabel: '', tasks: [], events: [], showEvents: false, timeEdit: null, timeError: '', capacity: null, taskTitle: '', taskDay: '', taskEstimate: '', taskBusy: false, showTasks: false, showSetup: false, dayStart: '08:00', dayEnd: '23:00' },
  week: null,
  result: null,
  undo: null,

  async onShow() {
    const target = getApp().agendaTarget;
    getApp().agendaTarget = null;
    if (typeof target?.week === 'number' && Number.isFinite(target.week)) this.week = target.week;
    this.setData({ showTasks: target?.action === 'tasks' || this.data.showTasks, showEvents: target?.action === 'events' || this.data.showEvents, showSetup: target?.action === 'setup' || this.data.showSetup });
    await this.refresh();
  },
  async onPullDownRefresh() { await this.refresh(); wx.stopPullDownRefresh(); },

  async refresh() {
    const ticket = (this.ticket || 0) + 1;
    this.ticket = ticket;
    this.setData({ loading: true, error: '', capacity: null, days: [], stats: [], brief: [], conflicts: [] });
    try {
      await ensureLoaded();
      if (!Number.isFinite(this.week)) this.week = weekStart(Date.now());
      const { snapshot } = getState();
      this.paintItems(snapshot);
      const week = this.week;
      const reference = Math.max(Date.parse(snapshot.reference_time), Math.ceil(Date.now() / 60000) * 60000);
      const result = await api('/api/v3/calendar', { snapshot: { ...snapshot, reference_time: new Date(reference).toISOString() }, range: weekRange(week) });
      if (this.ticket !== ticket || snapshot !== getState().snapshot) return;
      this.result = result;
      this.paint();
    } catch (error) {
      if (this.ticket === ticket) this.setData({ loading: false, error: error.message });
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
      return { label: `${monthDay(dayStart)} ${name}`, today: now >= dayStart && now < dayEnd, past: dayEnd <= now, rows };
    });
    const conflicts = this.result.conflicts.map(conflict => ({
      key: conflictKey(conflict), id: conflict.id, label: CONFLICT_LABEL[conflict.type] || '叠墨',
      when: conflict.start ? `${monthDay(Date.parse(conflict.start))}${conflict.minutes ? ` · ${conflict.minutes}分钟` : ''}` : '',
      advice: conflict.advice || conflict.reason || '',
      strategies: (conflict.strategies || []).map((strategy, index) => ({ index, label: strategy.label, detail: strategy.detail, recommended: Boolean(strategy.recommended) })),
    }));
    const count = type => items.filter(item => item.type === type).length;
    const remaining = remainingCapacity(this.result, Math.max(start, Math.ceil(now / 60000) * 60000), start + 7 * DAY);
    const capacity = remaining && start + 7 * DAY > now
      ? { total: minutesLabel(remaining.total), longest: minutesLabel(remaining.longest), pending: this.result.undefined.length > 0 } : null;
    this.setData({
      loading: false,
      weekLabel: `${monthDay(start)} — ${monthDay(start + 6 * DAY)}`,
      days, conflicts, capacity,
      brief: weeklyBrief(items, start, now).map(line => line.replace(/<\/?b>/g, '')),
      stats: [[count('routine'), '底色'], [count('work') + count('appointment'), '落笔'], [count('temporary'), '点墨'], [count('deadline'), '截止']],
      undoLabel: this.undo ? this.undo.label : '',
    });
  },

  paintItems(snapshot) {
    const tasks = snapshot.tasks.filter(isPersonal).map(task => ({
      id: task.id, title: task.title, day: personalDay(task), estimate: task.estimate_minutes ?? '', status: task.status,
      timed: Boolean(task.deadline_at && (!task.earliest_start_at || !task.deadline_at.includes('T23:59:'))),
      deadline: timeParts(task.deadline_at),
    }));
    const events = snapshot.events.filter(event => event.status === 'active').map(event => ({
      id: event.id, title: event.title, kind: event.kind === 'appointment' ? '约定' : '点墨',
      start: timeParts(event.start_at), end: timeParts(event.end_at),
    }));
    this.setData({ tasks, events, taskDay: this.data.taskDay || localDay(Date.now()) });
  },

  toggleTasks() { this.setData({ showTasks: !this.data.showTasks }); },
  toggleEvents() { this.setData({ showEvents: !this.data.showEvents }); },
  openTimeEditor(event) {
    const { id, kind } = event.currentTarget.dataset;
    const { snapshot } = getState();
    const item = (kind === 'task' ? snapshot?.tasks : snapshot?.events)?.find(entry => entry.id === id);
    if (!item) return;
    this.setData({ timeEdit: { id, kind, title: item.title, start: timeParts(item.start_at),
      end: timeParts(kind === 'task' ? item.deadline_at : item.end_at) }, timeError: '' }, () => {
      wx.pageScrollTo({ selector: '#time-editor', duration: 180 });
    });
  },
  editTimePart(event) {
    const { side, field } = event.currentTarget.dataset;
    this.setData({ [`timeEdit.${side}.${field}`]: event.detail.value, timeError: '' });
  },
  clearTimePart(event) {
    this.setData({ [`timeEdit.${event.currentTarget.dataset.side}`]: { day: '', time: '' }, timeError: '' });
  },
  closeTimeEditor() { this.setData({ timeEdit: null, timeError: '' }); },
  async saveTimeEditor() {
    const draft = this.data.timeEdit;
    if (!draft) return;
    try {
      const end = dateTime(draft.end, draft.kind === 'task' ? '截止' : '结束');
      const start = draft.kind === 'event' ? dateTime(draft.start, '开始') : null;
      const saved = await this.saveTask(snapshot => draft.kind === 'task' ? setTaskDeadline(snapshot, draft.id, end)
        : updateEvent(snapshot, draft.id, { start_at: start, end_at: end }), { inline: true });
      if (saved) this.closeTimeEditor();
    } catch (error) { this.setData({ timeError: error.message }); }
  },
  toggleSetup() { this.setData({ showSetup: !this.data.showSetup }); },
  tryCapacity() {
    getApp().agendaDraft = '这周再接4小时的社团工作，留6小时休息，时间够吗？';
    wx.switchTab({ url: '/pages/import/index' });
  },
  taskInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({ [field]: event.detail.value });
  },
  editTask(event) {
    const { id, field, status } = event.currentTarget.dataset;
    const value = event.detail.value;
    const task = this.data.tasks.find(item => item.id === id);
    if (field === 'estimate' && String(task?.estimate ?? '') === value) return;
    return this.saveTask(snapshot => field === 'day' ? setPersonalDay(snapshot, id, value)
      : updateTask(snapshot, id, field === 'estimate' ? { estimate_minutes: value ? Number(value) : null }
        : { status: status === 'completed' ? 'active' : 'completed' }));
  },
  async saveTask(change, { inline = false } = {}) {
    if (this.data.taskBusy) return false;
    this.setData({ taskBusy: true });
    try {
      await ensureLoaded();
      if (!await commit(change(getState().snapshot))) throw new Error('清单在另一台设备上更新了，请重试。');
      await this.refresh();
      return true;
    } catch (error) {
      if (inline) this.setData({ timeError: error.message });
      else wx.showToast({ title: error.message, icon: 'none' });
      return false;
    } finally { this.setData({ taskBusy: false }); }
  },
  async createTask() {
    const { taskTitle, taskDay, taskEstimate } = this.data;
    if (await this.saveTask(snapshot => addPersonalTask(snapshot, {
      title: taskTitle, day: taskDay, estimate_minutes: taskEstimate ? Number(taskEstimate) : null,
    }))) this.setData({ taskTitle: '', taskEstimate: '' });
  },
  saveWindow() {
    const { dayStart, dayEnd } = this.data;
    return this.saveTask(snapshot => setDailyWindow(snapshot, Array.from({ length: 7 }, () => ({ start: dayStart, end: dayEnd }))));
  },

  shiftWeek(event) {
    const step = Number(event.currentTarget.dataset.step);
    const current = Number.isFinite(this.week) ? this.week : weekStart(Date.now());
    this.week = step === 0 ? weekStart(Date.now()) : current + step * 7 * DAY;
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
    wx.showLoading({ title: '正在重排' });
    try {
      if (!await commit(next)) { await this.refresh(); return; }
      this.undo = { before: snapshot, after: getState().snapshot, label: strategy.label };
      if (strategy.action === 'skip_routine_date') this.draftNote(conflict, strategy);
      await this.refresh();
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    finally { wx.hideLoading(); }
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
    const { before, after } = this.undo;
    this.undo = null;
    this.setData({ note: '', undoLabel: '' });
    if (getState().snapshot !== after) {
      wx.showToast({ title: '清单已有新修改，不能撤销这一步', icon: 'none' });
      return;
    }
    await this.saveTask(snapshot => ({ ...before, revision: snapshot.revision + 1 }));
  },
});
