'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { DesktopUpdateService } = require('../dist/updateService.js');

class FakeUpdateAgent extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checkCount = 0;
  downloadCount = 0;
  installCount = 0;

  async checkForUpdates() { this.checkCount += 1; }
  async downloadUpdate() { this.downloadCount += 1; }
  quitAndInstall() { this.installCount += 1; }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const noTimer = () => ({ unref() {} });

test('未打包或缺少 app-update.yml 时不检查网络，并暴露真实状态', () => {
  const disabledAgent = new FakeUpdateAgent();
  const disabled = new DesktopUpdateService(disabledAgent, {
    enabled: false,
    configured: true,
    confirmDownload: async () => false,
    confirmInstall: async () => false,
    schedule: noTimer,
  });
  assert.equal(disabled.start().status, 'disabled');
  assert.equal(disabledAgent.checkCount, 0);

  const unconfiguredAgent = new FakeUpdateAgent();
  const unconfigured = new DesktopUpdateService(unconfiguredAgent, {
    enabled: true,
    configured: false,
    confirmDownload: async () => false,
    confirmInstall: async () => false,
    schedule: noTimer,
  });
  assert.equal(unconfigured.start().status, 'unconfigured');
  assert.equal(unconfiguredAgent.checkCount, 0);
});

test('发现更新后必须经用户确认才下载，进度和已下载状态可诊断', async () => {
  const agent = new FakeUpdateAgent();
  const states = [];
  const service = new DesktopUpdateService(agent, {
    enabled: true,
    configured: true,
    confirmDownload: async () => true,
    confirmInstall: async () => false,
    onState: (state) => states.push(state),
    schedule: noTimer,
  });
  service.start();
  agent.emit('update-available', { version: '1.0.4' });
  await flush();
  assert.equal(agent.downloadCount, 1);
  agent.emit('download-progress', { percent: 41.5, transferred: 415, total: 1000 });
  assert.deepEqual(
    { status: service.getState().status, percent: service.getState().percent },
    { status: 'downloading', percent: 41.5 },
  );
  agent.emit('update-downloaded', { version: '1.0.4' });
  await flush();
  assert.equal(service.getState().status, 'downloaded');
  assert.equal(agent.installCount, 0, '选择退出时安装不得强制重启');
  assert.ok(states.some((state) => state.status === 'available'));
});

test('只有明确确认才重启安装，检查错误映射为稳定错误码', async () => {
  const installAgent = new FakeUpdateAgent();
  const installService = new DesktopUpdateService(installAgent, {
    enabled: true,
    configured: true,
    confirmDownload: async () => false,
    confirmInstall: async () => true,
    schedule: noTimer,
  });
  installService.start();
  installAgent.emit('update-downloaded', { version: '1.0.4' });
  await flush();
  assert.equal(installAgent.installCount, 1);

  const failingAgent = new FakeUpdateAgent();
  failingAgent.checkForUpdates = async () => { throw new Error('token=private-value'); };
  let captured = null;
  const failingService = new DesktopUpdateService(failingAgent, {
    enabled: true,
    configured: true,
    confirmDownload: async () => false,
    confirmInstall: async () => false,
    onError: (_error, state) => { captured = state; },
    schedule: noTimer,
  });
  failingService.start();
  await failingService.check();
  assert.equal(captured.errorCode, 'UPDATE_CHECK_FAILED');
  assert.equal(failingService.getState().status, 'error');
  assert.equal('technicalMessage' in failingService.getState(), false, '公开状态不得包含原始错误文本');
});
