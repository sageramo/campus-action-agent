# 司序 Marshal · 小程序

微信小程序版的司序：微信登录、每人一份云端清单，四层计算仍由司序后端完成。

- `miniprogram/`：小程序前端。`lib/` 由 `node scripts/sync-lib.mjs` 从网页版 `campus-action-agent/` 生成，清单格式与网页版一致，可以互相导入。
- `cloudfunctions/sixu/`：唯一的云函数。身份只认微信 OPENID；`snapshots` 集合以 OPENID 为文档 id 存整份清单（带版本号，不同设备不会互相覆盖）；`api` 把计算请求转发给 `https://campus-action-agent-back.onrender.com`。
- 云开发环境：`cloud1-d1gxezferb4c8eaab`。

## 部署云函数
在微信开发者工具里右键 `cloudfunctions/sixu` → 「上传并部署：云端安装依赖」。超时时间在云开发控制台确认为 60 秒（后端闲置后唤醒要半分钟左右）。

可选环境变量（云开发控制台 → 云函数 → sixu → 配置）：`SIXU_ACCESS` 设为后端访问口令后，小程序才能用模型功能；不设只用规则。口令只放在这里，不写进代码。
