# 零 Key Demo

```bash
pnpm install
pnpm test:smoke
pnpm dev
```

手工路径：

1. 在项目切换器创建项目。
2. 点击“导入原著”，粘贴至少一个章节。
3. 检查 Story Graph 的章节、事件与关系。
4. 点击“导演建议”，查看计划和影响范围。
5. 批准计划，切换 Production Graph。
6. 运行 Demo Production，检查每个 Shot 的两个 Candidate、Critic 意见和 Prompt/Artifact 证据。
7. 切换 Delivery Graph，选择系统目录并导出。
8. 用 FFprobe 或系统播放器验证 MP4。
9. 重启服务，确认项目、Candidate 和任务仍存在。

全程应显示 `demo-local`、`billed=false`，网络门禁开启。自动 Critic 不得自动选中候选；必须人工批准后才能导出。任何需要真实 Provider 的按钮都不得在 Demo 中静默发起请求。
