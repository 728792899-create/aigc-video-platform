# v1.6.14 修复报告：预览区播放真实动态视频

## 问题原因（根本性架构差异）

**用户反馈**："成片库点击播放是动态的，而在视频预览播放视频时或者直接在成片库查看项目点击进入后预览都是静图拼接的视频。"

**真正根因**：预览页和成片库用了**两套完全不同的渲染机制**：

1. **成片库 `Library.vue`**：
   - 用原生 `<video :src="mediaUrl(it.file_url)" controls>` 播放真实合成的完整成片 mp4
   - 视频包含真实的**转场过渡动画**（淡入淡出/滑动）、**字幕动画**（烧录/卡拉OK）、**运镜滤镜**（zoom/pan）
   - 用户看到的"动态视频" ✅

2. **预览页 `Preview.vue`（v1.6.13 及之前）**：
   - 用 canvas 逐帧绘制 `thumbnailUrl` 缩略图，纯前端模拟
   - 只能模拟单镜头内的简单 zoom/pan（Ken Burns 效果）
   - **无法呈现**真实合成视频的转场过渡动画、字幕动画、真实运镜滤镜
   - 用户看到的"静图拼接" ✗

**为什么 canvas 模拟做不到"动态"**：
- canvas 只是重复绘制静态缩略图，即使加了 Ken Burns 缩放平移，也只是单张图的变换
- 真实合成视频的"动效"来自：镜头间的**转场动画**（FFmpeg overlay + fade/slide/zoom filters）、**字幕动画**（FFmpeg drawtext fade/slide）、真实运镜滤镜（zoompan）
- 这些都需要 FFmpeg 真合成才能实现，canvas 静图绘制根本做不到

**v1.6.12-v1.6.13 错误修复方向回顾**：
- v1.6.12：PATCH `scene.motion||'zoom-in'` → 试图给 canvas 模拟加默认运镜
- v1.6.13：PATCH 读 `presetConfig().motion` 回退 → 仍是 canvas 模拟方向
- **两次修复都猜错了**：用户要的不是"让 canvas 模拟动起来"，而是**预览区根本不该用 canvas 模拟，应该像成片库一样播放真实 mp4**

## 修复方案（v1.6.14）

### 核心思路

**让预览区默认播放真实成片**（与成片库观看体验完全一致），没有成片时才回退到 canvas 草稿模拟。

### 实现细节

1. **Import `projectExports` API**：
   - 前端已有 `api/features.js:14 projectExports(projectId)` 接口，返回该项目所有成片

2. **增加 refs**（`Preview.vue:225-230`）：
   ```js
   const videoRef = ref(null)  // video 元素引用
   const playMode = ref('canvas')  // 'video' | 'canvas'
   const projectVideoUrl = ref('')  // 最新成片的可播放 URL
   ```

3. **Template 改动**（`Preview.vue:3-30`）：
   ```vue
   <div class="canvas-wrapper">
     <!-- 真实成片：原生 video 播放器（动态视频，与成片库一致） -->
     <video v-show="playMode === 'video'" ref="videoRef" :src="projectVideoUrl" controls />
     <!-- 草稿模拟：canvas 逐帧绘制（还没成片时的占位） -->
     <canvas v-show="playMode === 'canvas'" ref="canvasRef" />
   </div>
   <!-- 模式切换条（有成片时显示） -->
   <div v-if="projectVideoUrl" class="play-mode-bar">
     <el-radio-group v-model="playMode" @change="onPlayModeChange">
       <el-radio-button value="video">🎬 真实成片</el-radio-button>
       <el-radio-button value="canvas">✏️ 草稿模拟</el-radio-button>
     </el-radio-group>
   </div>
   ```

4. **新增函数**（`Preview.vue:1051-1093`）：
   - `loadProjectVideo()`：查该项目最新成片（`projectExports` API），有则设 `projectVideoUrl` + `playMode='video'`（默认播真实视频），无则回退 `playMode='canvas'`
   - `stopCanvasPlayback()`：停掉 canvas 模拟播放与配音（切到真实视频时调用，避免双声）
   - `onPlayModeChange(mode)`：用户手动切换模式时，暂停另一套播放器

5. **onMounted 调用**（`Preview.vue:1107`）：
   ```js
   onMounted(() => {
     fetchProject().finally(() => { initCanvas() })
     fetchStoryboards()
     loadPresets()
     loadSnapshots()
     loadT2v()
     loadProjectVideo()  // 查最新成片，有则默认播真实视频
   })
   ```

6. **导出成功后自动刷新**（`Preview.vue:883`）：
   ```js
   onSuccess: (task) => {
     ElMessage.success(t('preview.composeSuccess'))
     window.open(mediaUrl(data.file_url), '_blank')
     loadProjectVideo()  // 刷新成片列表，自动切到真实视频播放
     resolve()
   }
   ```

7. **CSS 样式**（`Preview.vue:1201-1226`）：
   ```css
   .preview-video {
     width: 100%; height: 100%;
     object-fit: contain; background: #000;
   }
   .play-mode-bar {
     display: flex; align-items: center; gap: 12px;
   }
   ```

8. **i18n 多语言**（`locales/modules/preview.js:49-51, 125-127`）：
   ```js
   zh: {
     modeRealVideo: '真实成片', modeDraft: '草稿模拟',
     modeRealVideoHint: '正在播放真实合成的动态视频（与成片库一致）',
     modeDraftHint: '草稿模拟预览（还未导出成片，仅供编辑参考）',
   }
   ```

## 修改文件清单

- `client/src/views/Preview.vue`（1485→1519 行，+66 行 template/script/style）
  - `:214` import projectExports
  - `:228-230` 新增 refs（videoRef/playMode/projectVideoUrl）
  - `:4-30` template 增加 video 元素 + 模式切换条
  - `:883` doCompose onSuccess 调 loadProjectVideo
  - `:1051-1093` 新增 loadProjectVideo/stopCanvasPlayback/onPlayModeChange 三函数
  - `:1107` onMounted 调 loadProjectVideo
  - `:1116` onUnmounted 暂停真实视频
  - `:1201-1226` 新增 .preview-video / .play-mode-bar CSS
- `client/src/locales/modules/preview.js`（+8 行 i18n）
  - `:49-51` zh 新增 4 个 key
  - `:125-127` en 新增 4 个 key
- `package.json` version 1.6.13 → **1.6.14**

## 验证方式

### 场景 1：项目已有成片
1. 进入预览页 → **预览区自动播放真实成片视频**（动态，含转场/字幕动画）
2. 模式切换条显示"🎬 真实成片"已选中
3. 点击"✏️ 草稿模拟" → 切换到 canvas 逐帧绘制
4. 再切回"🎬 真实成片" → 播放真实视频

### 场景 2：项目还没导出成片
1. 进入预览页 → **预览区显示 canvas 草稿模拟**（原有行为）
2. 模式切换条不显示（因为 `v-if="projectVideoUrl"` 为空）
3. 点击"导出视频" → 合成成功后 → **预览区自动切换到播放刚导出的真实成片**
4. 模式切换条出现

### 场景 3：与成片库对比
- **成片库**：video 播放器 + controls → 动态视频 ✅
- **预览区（v1.6.14，真实成片模式）**：video 播放器 + controls → 动态视频 ✅
- **两者完全一致**

## 影响范围

- **零破坏**：canvas 模拟逻辑完全保留，作为"还没成片时的草稿预览"
- **纯加法**：增加真实视频播放能力，有成片则默认播放，用户可自由切换
- **API 兼容**：复用现有 `projectExports` 接口，无需后端改动
- **样式兼容**：`.preview-video` 继承 `.canvas-wrapper` 容器的 flex/aspect-ratio 约束，响应式布局不变

## 技术细节

### 为什么要两套播放器共存（video + canvas）？
1. **真实成片播放**（video）：给用户"所见即所得"的最终效果，与成片库一致
2. **草稿模拟**（canvas）：还没导出成片时，给用户一个"大致预览"（虽然缺少转场/字幕动画，但能看到分镜排列和基本画面）

### 为什么 canvas 模拟做不到"动态"？
- canvas 每帧只是 `drawImage(缩略图)` + 简单的 translate/scale 变换
- 真实合成视频的"动效"来自：
  - **转场动画**：FFmpeg `-filter_complex "overlay + fade/slide"` 两镜头叠加过渡
  - **字幕动画**：FFmpeg `drawtext` 的 `fade=t=in:st=0:d=0.5` 等时间函数
  - **真实运镜**：FFmpeg `zoompan` filter 的连续帧计算
- 这些都需要 FFmpeg 逐帧渲染，canvas 静图绘制根本做不到

### 为什么不用"快速预览"（preview-compose）？
- 快速预览（`:879 doQuickPreview`）调后端真合成前 3 镜，但结果是 `window.open` **新窗口打开**
- 用户要的是"预览区内直接播放真实视频"，不是新窗口
- 而且快速预览只合成前 3 镜，用户要看完整成片
- 所以方案是：预览区调 `projectExports` 查该项目已导出的**完整成片**，直接在预览区内用 video 播放

## 回顾：为何 v1.6.12/v1.6.13 修复无效

### v1.6.12 错误方向
- **改动**：`scene.motion||'zoom-in'` → 给 canvas 模拟加默认运镜
- **假设**：用户要的是"canvas 模拟有运镜动效"
- **实际用户需求**：预览要播真实 mp4，不要 canvas 模拟
- **结果**：无效（canvas 仍是静图，只是多了个 zoom-in 缩放）

### v1.6.13 错误方向
- **改动**：读 `presetConfig().motion` 回退 → 仍是给 canvas 模拟补默认运镜
- **假设**：用户是在说"canvas 模拟的运镜消失了"
- **实际用户需求**：canvas 根本不该出现在"已有成片"的预览场景
- **结果**：无效（本质上还是 canvas 静图模拟，和 v1.6.12 一样）

### v1.6.14 正确方向
- **改动**：预览区接入真实成片播放（video），与成片库对齐
- **理解**：用户说的"成片库是动态的"，是指播放真实 mp4（含转场/字幕动画），不是指单镜头运镜
- **结果**：预览区默认播真实成片 mp4 → 动态视频（与成片库完全一致） ✅

## 总结

**v1.6.14 核心修复**：预览页默认播放真实成片（与成片库一致的动态视频），彻底解决"静图拼接"问题。canvas 模拟保留作为"还没成片时的草稿预览"。

**用户体验**：
- 进入预览页 → 有成片则自动播真实视频（动态，含转场/字幕动画）
- 导出成功后 → 预览区自动刷新，播放刚导出的成片
- 与成片库观看体验完全一致 ✅

**技术价值**：
- 纯加法修复，零破坏
- 复用现有 `projectExports` API
- 两套播放器共存（video 真实 + canvas 草稿），覆盖所有场景
