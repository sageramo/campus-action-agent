// 我的: a name of one's own, what is in the list, moving a list over from the web version (send the
// exported .json to 文件传输助手, then pick it here), and sending a backup back out.
import { ensureLoaded, getState, commit, setName } from '../../utils/store.js';
import { parseTimeSnapshot, serializeTimeSnapshot } from '../../lib/time-state.js';

Page({
  data: { name: '', draft: '', counts: [], savedName: false, error: '' },

  async onShow() {
    try {
      await ensureLoaded();
      const { profile, snapshot } = getState();
      const active = list => list.filter(item => item.status !== 'cancelled' && item.status !== 'completed').length;
      this.setData({
        name: profile.name, draft: profile.name, error: '',
        counts: [[snapshot.routines.length, '底色'], [active(snapshot.tasks), '截止之事'], [active(snapshot.events), '点墨与约定'], [snapshot.sources.length, '份原文']],
      });
    } catch (error) { this.setData({ error: error.message }); }
  },

  onName(event) { this.setData({ draft: event.detail.value }); },
  async saveName() {
    try {
      const profile = await setName(this.data.draft);
      this.setData({ name: profile.name });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },

  importFromWeb() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json'],
      success: ({ tempFiles }) => {
        let next;
        try {
          next = parseTimeSnapshot(wx.getFileSystemManager().readFileSync(tempFiles[0].path, 'utf8'));
        } catch (error) { wx.showToast({ title: `读不出这份清单：${error.message}`, icon: 'none' }); return; }
        wx.showModal({
          title: '用这份清单替换云端的？',
          content: `其中有 ${next.tasks.length} 件截止之事、${next.events.length} 处点墨与约定、${next.routines.length} 项底色。替换后原来的云端清单不再保留。`,
          confirmText: '替换',
          success: async ({ confirm }) => {
            if (!confirm) return;
            await commit({ ...next, revision: getState().snapshot.revision + 1 });
            wx.showToast({ title: '已换成这份清单', icon: 'success' });
            this.onShow();
          },
        });
      },
    });
  },

  exportBackup() {
    const path = `${wx.env.USER_DATA_PATH}/司序-清单.json`;
    try {
      wx.getFileSystemManager().writeFileSync(path, serializeTimeSnapshot(getState().snapshot), 'utf8');
      wx.shareFileMessage({ filePath: path, fileName: '司序-清单.json', fail: () => {} });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
  },
});
