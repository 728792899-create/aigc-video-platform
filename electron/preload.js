// ============================================================
//  AIGC 视频工作台 - preload 脚本
//  在隔离上下文下，向前端安全暴露一个极小的 API（仅语言同步）
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aigcStudio', {
  // 前端切换界面语言时调用，通知主进程重建原生菜单
  setLocale: (locale) => ipcRenderer.send('app:set-locale', locale === 'en' ? 'en' : 'zh'),
  selectExportDirectory: () => ipcRenderer.invoke('dialog:select-export-directory'),
});
