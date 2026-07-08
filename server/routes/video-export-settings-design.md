# 后端导出设置扩展设计文档

## 目标
为 `/video/compose` 接口扩展导出设置支持：
- 分辨率档位：720p/1080p/2k/4k（基于现有 ratio 缩放）
- 格式：mp4/mov/webm/gif
- 画质：standard/high/ultra → CRF 28/23/18
- 帧率：24/30/60（现有 fps 保持）

## 新增 options 字段

```js
options = {
  // === 新增导出设置 ===
  resolution: '1080p',  // '720p' | '1080p' | '2k' | '4k'  (默认 1080p)
  format: 'mp4',        // 'mp4' | 'mov' | 'webm' | 'gif'  (默认 mp4)
  quality: 'high',      // 'standard' | 'high' | 'ultra'   (默认 high)
  
  // === 现有字段保持兼容 ===
  ratio: '16:9',        // 画幅比例
  fps: 30,              // 帧率
  burnSubtitle: true,
  // ... 其它现有字段
}
```

## 分辨率档位表（基于 ratio 动态缩放）

| resolution | 基准长边 | 16:9 实际尺寸 | 9:16 实际尺寸 | 1:1 实际尺寸 | 4:3 实际尺寸 | 4:5 实际尺寸 |
|------------|----------|---------------|---------------|--------------|--------------|--------------|
| 720p       | 1280     | 1280×720      | 720×1280      | 720×720      | 960×720      | 720×900      |
| 1080p      | 1920     | 1920×1080     | 1080×1920     | 1080×1080    | 1440×1080    | 1080×1350    |
| 2k         | 2560     | 2560×1440     | 1440×2560     | 1440×1440    | 1920×1440    | 1440×1800    |
| 4k         | 3840     | 3840×2160     | 2160×3840     | 2160×2160    | 2880×2160    | 2160×2700    |

**算法**：
1. 解析 ratio 得到宽高比（如 16:9 → w_ratio=16, h_ratio=9）
2. 根据 resolution 档位决定基准像素（1080p → base=1920）
3. 根据宽高比计算实际尺寸：
   - 如果是横屏（w > h）：w=base, h=base*(h_ratio/w_ratio)
   - 如果是竖屏（h > w）：h=base, w=base*(w_ratio/h_ratio)
   - 方形：w=h=base*0.5625（对齐 1080）

## 格式映射表

| format | 容器 | 视频编码器 | 音频编码器 | 扩展名 | 说明 |
|--------|------|-----------|-----------|--------|------|
| mp4    | mp4  | libx264   | aac       | .mp4   | 默认，兼容性最好 |
| mov    | mov  | libx264   | aac       | .mov   | 苹果生态 |
| webm   | webm | libvpx-vp9| libopus   | .webm  | 开源，体积小 |
| gif    | gif  | gif       | (无)      | .gif   | 特殊处理palettegen |

**ffmpeg 编码参数**：
- mp4/mov: `-f <format> -c:v libx264 -crf <crf> -c:a aac -b:a 192k`
- webm: `-f webm -c:v libvpx-vp9 -crf <crf> -b:v 0 -c:a libopus -b:a 128k`
- gif: 特殊两阶段（palettegen + paletteuse），无音频

## 画质 → CRF 映射

| quality  | CRF | 说明 |
|----------|-----|------|
| standard | 28  | 标清，编码快，文件小 |
| high     | 23  | 高清，默认值 |
| ultra    | 18  | 超清，编码慢，文件大 |

注：CRF 越低画质越高，文件越大。libx264 有效范围 0-51，23 是默认推荐值。

## 代码改动点

### 1. 新增辅助函数（在 `resolveResolution` 后）

```js
/**
 * 分辨率档位 → 实际像素（基于 ratio 动态缩放）
 * @param {string} resolution '720p'|'1080p'|'2k'|'4k'
 * @param {string} ratio '16:9'|'9:16'|'1:1'|'4:3'|'4:5' 等
 * @returns {{w:number, h:number}}
 */
function resolveResolutionByTier(resolution, ratio) {
  // 档位基准（横屏长边）
  const TIER_BASE = { '720p': 1280, '1080p': 1920, '2k': 2560, '4k': 3840 };
  const base = TIER_BASE[resolution] || 1920;
  
  // 解析 ratio 为数值比例
  const key = String(ratio || '16:9').replace(/[_x]/g, ':').trim();
  const alias = { portrait: '9:16', vertical: '9:16', landscape: '16:9', square: '1:1' };
  const normalized = alias[key] || key;
  const parts = normalized.split(':');
  const wr = parseFloat(parts[0]) || 16;
  const hr = parseFloat(parts[1]) || 9;
  
  // 方形特殊处理：对齐 1080p 基准
  if (Math.abs(wr - hr) < 0.01) {
    const square = Math.round(base * 0.5625); // 1920*0.5625=1080
    return { w: square, h: square };
  }
  
  // 横屏/竖屏：以长边为基准缩放
  if (wr > hr) {
    // 横屏：宽=base
    return { w: base, h: Math.round(base * (hr / wr)) };
  } else {
    // 竖屏：高=base
    return { w: Math.round(base * (wr / hr)), h: base };
  }
}

/**
 * 格式 → ffmpeg 编码参数
 * @param {string} format 'mp4'|'mov'|'webm'|'gif'
 * @returns {{ext:string, container:string, vcodec:string, acodec:string|null}}
 */
function resolveOutputFormat(format) {
  const FORMAT_MAP = {
    mp4:  { ext: '.mp4',  container: 'mp4',  vcodec: 'libx264',   acodec: 'aac' },
    mov:  { ext: '.mov',  container: 'mov',  vcodec: 'libx264',   acodec: 'aac' },
    webm: { ext: '.webm', container: 'webm', vcodec: 'libvpx-vp9', acodec: 'libopus' },
    gif:  { ext: '.gif',  container: 'gif',  vcodec: 'gif',       acodec: null },
  };
  return FORMAT_MAP[format] || FORMAT_MAP.mp4;
}

/**
 * 画质 → CRF 值
 * @param {string} quality 'standard'|'high'|'ultra'
 * @returns {number}
 */
function resolveCRF(quality) {
  const CRF_MAP = { standard: 28, high: 23, ultra: 18 };
  return CRF_MAP[quality] || 23;
}
```

### 2. 扩展 `resolveResolution()` 函数（兼容现有调用）

```js
// 改前：
function resolveResolution(ratio) {
  if (!ratio) return RATIO_PRESETS['16:9'];
  const key = String(ratio).replace(/[_x]/g, ':').trim();
  const alias = { portrait: '9:16', vertical: '9:16', landscape: '16:9', square: '1:1' };
  return RATIO_PRESETS[alias[key] || key] || RATIO_PRESETS['16:9'];
}

// 改后（向后兼容，支持 options.resolution）：
function resolveResolution(ratioOrOptions) {
  // 新用法：传 options 对象（带 resolution + ratio）
  if (ratioOrOptions && typeof ratioOrOptions === 'object') {
    const { resolution, ratio } = ratioOrOptions;
    if (resolution && ['720p', '1080p', '2k', '4k'].includes(resolution)) {
      return resolveResolutionByTier(resolution, ratio);
    }
    // 无档位则回退现有 ratio 逻辑
    return resolveResolution(ratio);
  }
  // 旧用法：直接传 ratio 字符串（现有代码兼容）
  const ratio = ratioOrOptions;
  if (!ratio) return RATIO_PRESETS['16:9'];
  const key = String(ratio).replace(/[_x]/g, ':').trim();
  const alias = { portrait: '9:16', vertical: '9:16', landscape: '16:9', square: '1:1' };
  return RATIO_PRESETS[alias[key] || key] || RATIO_PRESETS['16:9'];
}
```

### 3. 编码函数扩展（以 `imageAudioToSegment` 为例）

**改前**（硬编码 libx264/aac）：
```js
args = [..., '-c:v', 'libx264', '-c:a', 'aac', '-b:a', '192k', ...];
```

**改后**（从 options 传入）：
```js
async function imageAudioToSegment(imagePath, audioPath, duration, outputPath, options = {}) {
  const fps = options.fps || 30;
  const { w, h } = options.resolution || resolveResolution(options.ratio);
  const fmt = resolveOutputFormat(options.format || 'mp4');
  const crf = resolveCRF(options.quality || 'high');
  
  // ... 现有逻辑 ...
  
  // 编码参数（替换硬编码）
  const vcodecArgs = ['-c:v', fmt.vcodec];
  if (fmt.vcodec === 'libx264') {
    vcodecArgs.push('-crf', String(crf), '-tune', 'stillimage');
  } else if (fmt.vcodec === 'libvpx-vp9') {
    vcodecArgs.push('-crf', String(crf), '-b:v', '0');
  }
  
  const acodecArgs = fmt.acodec
    ? ['-c:a', fmt.acodec, '-b:a', fmt.acodec === 'libopus' ? '128k' : '192k']
    : [];
  
  if (hasAudio) {
    args = ['-y', '-loop', '1', '-t', String(frameDur), '-i', imagePath,
            '-i', audioPath, '-vf', vfilter, '-af', 'apad',
            ...vcodecArgs, ...acodecArgs,
            '-pix_fmt', 'yuv420p', '-t', String(frameDur), '-r', String(fps), outputPath];
  } else {
    args = ['-y', '-loop', '1', '-t', String(frameDur), '-i', imagePath,
            '-f', 'lavfi', '-t', String(frameDur), '-i', 'anullsrc',
            '-vf', vfilter,
            ...vcodecArgs, ...acodecArgs,
            '-pix_fmt', 'yuv420p', '-shortest', '-r', String(fps), outputPath];
  }
  await ffmpeg(...args);
  return outputPath;
}
```

**类似改动应用到**：
- `videoToSegment()`
- `concatWithTransitions()` (xfade 分支)
- `burnSubtitles()`
- `burnAss()`

注：
- `concatWithTransitions()` 的 `-c copy` 分支不改（无转场时直接拷贝流）
- `mixBgm()` 的 `-c:v copy` 不改（只混音不重编码视频）

### 4. `composeVideo` 扩展输出文件名

**改前**：
```js
const finalOutput = path.join(outputDir, `${isPreview ? 'preview' : 'project'}_${project_id}_${timestamp}.mp4`);
```

**改后**：
```js
const fmt = resolveOutputFormat(options.format || 'mp4');
const finalOutput = path.join(outputDir, `${isPreview ? 'preview' : 'project'}_${project_id}_${timestamp}${fmt.ext}`);
```

### 5. `composeVideo` 传递 resolution 对象到 `resolveResolution`

**改前**：
```js
const resolution = resolveResolution(options.ratio);
```

**改后**：
```js
const resolution = resolveResolution(options); // 传整个 options，内部自动识别 resolution+ratio
```

### 6. 所有调用编码函数的地方传递 format/quality

**`generateSegments` 内部**：
```js
await imageAudioToSegment(sb.image_path, audioPath, sb.duration || 5, segPath, {
  fps: options.fps || 30,
  resolution,
  motion: sb.motion || options.motion,
  format: options.format,    // 新增
  quality: options.quality,  // 新增
});

await videoToSegment(gen.local_path, audioPath, segPath, {
  fps: options.fps || 30,
  resolution,
  format: options.format,    // 新增
  quality: options.quality,  // 新增
});
```

**`concatWithTransitions` 调用**：
```js
await concatWithTransitions(segments, transitions, tempVideo, {
  transitionDuration: options.transitionDuration || 0.5,
  format: options.format,    // 新增
  quality: options.quality,  // 新增
});
```

**`burnSubtitles`/`burnAss` 调用**（在 applySubtitles 内部）：
```js
await burnSubtitles(stageVideo, finalOutput, srtGen.filePath, style, {
  format: options.format,    // 新增
  quality: options.quality,  // 新增
});
```

## GIF 特殊处理（后续优化，本期暂不实现）

GIF 需要两阶段编码（palettegen + paletteuse），与视频流程差异较大。建议：
- 本期先支持 mp4/mov/webm 三种视频格式
- GIF 留作后续优化（单独路径处理，或前端提示"GIF 导出开发中"）

## 测试用例

```bash
# 1. 默认（1080p mp4 high）
curl -X POST http://localhost:3000/video/compose \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"async":true}'

# 2. 720p 标清
curl -X POST http://localhost:3000/video/compose \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"async":true,"options":{"resolution":"720p","quality":"standard"}}'

# 3. 4K 超清
curl -X POST http://localhost:3000/video/compose \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"async":true,"options":{"resolution":"4k","quality":"ultra"}}'

# 4. 竖屏 1080p WebM
curl -X POST http://localhost:3000/video/compose \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"async":true,"options":{"ratio":"9:16","resolution":"1080p","format":"webm"}}'

# 5. 抖音预设（竖屏 1080p mp4）
curl -X POST http://localhost:3000/video/compose \
  -H "Content-Type: application/json" \
  -d '{"project_id":1,"async":true,"options":{"ratio":"9:16","resolution":"1080p","format":"mp4","fps":30}}'
```

## 向后兼容性

- 所有新字段 optional，未传时使用默认值（1080p/mp4/high）
- `resolveResolution()` 保持旧签名兼容（传 ratio 字符串）
- 编码函数的 options 参数可选，未传则用现有硬编码默认值
- 现有项目无需修改任何代码即可继续工作
