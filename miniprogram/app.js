// 司序小程序。身份用微信（云函数里的 OPENID），每人一份清单存在云端，换手机用同一个微信即可。
App({
  globalData: { env: 'cloud1-d1gxezferb4c8eaab' },
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({ title: '微信版本过低', content: '请升级微信后再打开司序。', showCancel: false });
      return;
    }
    wx.cloud.init({ env: this.globalData.env, traceUser: true });
  },
});
