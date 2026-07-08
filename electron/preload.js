// ============================================================
//  史努比大王 - preload 脚本
//  在隔离上下文下，向前端安全暴露一个极小的 API（仅语言同步）
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snoopy', {
  // 前端切换界面语言时调用，通知主进程重建原生菜单
  setLocale: (locale) => ipcRenderer.send('app:set-locale', locale),
});
