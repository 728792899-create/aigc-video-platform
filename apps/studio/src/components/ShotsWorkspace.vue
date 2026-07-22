<template>
  <section
    class="shots-workspace"
    data-figma-node="14:184"
    data-figma-spec="T/07-Storyboard"
    aria-labelledby="shots-workspace-title"
  >
    <header class="shots-workspace__heading">
      <h1 id="shots-workspace-title">分镜导演工作区</h1>
      <p>把 Scene 拆为 Shot 与 Beat，明确边界帧、参考资产和生成前置条件。</p>
    </header>

    <div v-if="items.length" class="shots-workspace__layout">
      <nav class="shots-workspace__list" aria-label="镜头列表">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="shots-workspace__shot"
          :class="{ active: item.id === selectedId }"
          :aria-pressed="item.id === selectedId"
          :aria-label="`查看${item.title}的画面与镜头属性`"
          @click="selectedId = item.id"
        >
          <strong>{{ item.title }}</strong>
          <small>{{ projectLabel }} · revision {{ item.revision }}</small>
        </button>
      </nav>

      <figure class="shots-workspace__preview">
        <img v-if="activeItem?.imageUrl" :src="activeItem.imageUrl" :alt="`${activeItem.title}分镜画面`" />
        <span v-else class="shots-workspace__missing-media">
          <ImageOff :size="32" aria-hidden="true" />
          <span>该镜头尚未绑定分镜画面</span>
        </span>
        <figcaption>
          <strong class="shots-workspace__preview-title">{{ activeItem?.title }}</strong>
          <span>{{ activeItem?.previewMeta }}</span>
        </figcaption>
      </figure>

      <aside class="shots-workspace__inspector" aria-labelledby="shots-inspector-title">
        <h2 id="shots-inspector-title">镜头属性</h2>
        <dl>
          <div><dt>景别：</dt><dd>{{ activeItem?.framing }}</dd></div>
          <div><dt>运镜：</dt><dd>{{ activeItem?.camera }}</dd></div>
          <div><dt>时长：</dt><dd>{{ activeItem?.duration }}</dd></div>
          <div><dt>首帧：</dt><dd>{{ activeItem?.startFrame }}</dd></div>
          <div><dt>尾帧：</dt><dd>{{ activeItem?.endFrame }}</dd></div>
        </dl>
        <section class="shots-workspace__references" aria-label="参考资产">
          <h3>参考资产</h3>
          <p v-for="reference in activeItem?.references" :key="reference">{{ reference }}</p>
        </section>
        <div class="shots-workspace__actions">
          <p :class="{ 'shots-workspace__ready--warning': !activeItem?.ready }" role="status">
            <Check v-if="activeItem?.ready" :size="14" aria-hidden="true" />
            <AlertTriangle v-else :size="14" aria-hidden="true" />
            {{ activeItem?.ready ? '前置条件已满足' : '仍有前置条件待处理' }}
          </p>
          <button type="button" :disabled="!activeItem?.ready" @click="$emit('navigate', 'generation')">
            前往生成队列
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="shots-workspace__empty">
      <ImageOff :size="30" aria-hidden="true" />
      <h2>还没有可编排的镜头</h2>
      <p>先完成来源导入与制作计划批准。生成的 Shot 和 Beat 会在这里形成可恢复的分镜结构。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Check, ImageOff } from 'lucide-vue-next'
import type { ProjectSnapshot, Shot } from '@aigc-director/contracts'
import type { StudioWorkspaceId } from '../workspaces.js'

type StoryboardItem = {
  id: string
  title: string
  revision: number
  imageUrl?: string
  previewMeta: string
  framing: string
  camera: string
  duration: string
  startFrame: string
  endFrame: string
  references: string[]
  ready: boolean
}

const props = defineProps<{ snapshot: ProjectSnapshot }>()
defineEmits<{ navigate: [workspaceId: StudioWorkspaceId] }>()

const demoStoryboard: StoryboardItem[] = [
  { id: 'demo-shot-01', title: 'SHOT 01 · 修复星图', revision: 3, imageUrl: '/demo/xingque/storyboard-05.png', previewMeta: '2 Beats · 4.2s · 俯拍转中景 · 道具连续性', framing: '俯拍 → 中景', camera: '缓慢下压', duration: '4.2 秒', startFrame: '星图刻线熄灭', endFrame: '第一段坐标复亮', references: ['苏绫 r1 · 零尾 r1', '司南星核 r1 · 档案塔 r1'], ready: true },
  { id: 'demo-shot-02', title: 'SHOT 02 · 星核升起', revision: 3, imageUrl: '/demo/xingque/storyboard-01.png', previewMeta: '3 Beats · 4.8s · 中景转特写 · 双角色连续性', framing: '中景 → 特写', camera: '缓慢推进', duration: '4.8 秒', startFrame: '上一镜尾帧', endFrame: '星核完全点亮', references: ['苏绫 r1 · 玄戈 r1', '零尾 r1 · 司南星核 r1'], ready: true },
  { id: 'demo-shot-03', title: 'SHOT 03 · 云桥逃离', revision: 3, imageUrl: '/demo/xingque/storyboard-02.png', previewMeta: '3 Beats · 5.2s · 全景转跟拍 · 三角色连续性', framing: '全景 → 中景', camera: '手持跟拍', duration: '5.2 秒', startFrame: '塔门警报亮起', endFrame: '三人冲上云桥', references: ['苏绫 r1 · 玄戈 r1', '零尾 r1 · 云海机巧市 r1'], ready: true },
  { id: 'demo-shot-04', title: 'SHOT 04 · 广场坍塌', revision: 3, imageUrl: '/demo/xingque/storyboard-03.png', previewMeta: '2 Beats · 4.6s · 广角环绕 · 环境连续性', framing: '广角 → 中景', camera: '快速环绕', duration: '4.6 秒', startFrame: '云桥末端', endFrame: '星图碎片悬停', references: ['玄戈 r1 · 苏绫 r1', '零尾 r1 · 云海机巧市 r1'], ready: true },
  { id: 'demo-shot-05', title: 'SHOT 05 · 塔门对齐', revision: 3, imageUrl: '/demo/xingque/storyboard-04.png', previewMeta: '2 Beats · 4.4s · 全景定镜 · 边界帧连续性', framing: '全景 → 全景', camera: '固定镜头', duration: '4.4 秒', startFrame: '三人抵达塔门', endFrame: '星核嵌入门锁', references: ['苏绫 r1 · 玄戈 r1', '零尾 r1 · 星阙档案塔 r1'], ready: true },
  { id: 'demo-shot-06', title: 'SHOT 06 · 星图显现', revision: 3, imageUrl: '/demo/xingque/storyboard-06.png', previewMeta: '3 Beats · 5.0s · 远景拉升 · 终场连续性', framing: '中景 → 远景', camera: '缓慢拉升', duration: '5.0 秒', startFrame: '塔门完全开启', endFrame: '云海星图显现', references: ['苏绫 r1 · 玄戈 r1', '司南星核 r1 · 星阙档案塔 r1'], ready: true },
]

const isXingqueDemo = computed(() => props.snapshot.project.name.replace(/[《》]/gu, '') === '星阙回声')
const projectLabel = computed(() => {
  const name = props.snapshot.project.name.replace(/[《》]/gu, '')
  return `《${name}》`
})
const items = computed<StoryboardItem[]>(() => {
  const canonical = [...props.snapshot.shots].sort((left, right) => left.ordinal - right.ordinal)
  if (isXingqueDemo.value) {
    return demoStoryboard.map((demo, index) => ({
      ...demo,
      id: canonical[index]?.id ?? demo.id,
    }))
  }
  return canonical.map(toStoryboardItem)
})

const selectedId = ref('')
const activeItem = computed(() => items.value.find((item) => item.id === selectedId.value) ?? items.value[0])

watch(items, (next) => {
  if (!next.some((item) => item.id === selectedId.value)) selectedId.value = next[isXingqueDemo.value && next.length > 1 ? 1 : 0]?.id ?? ''
}, { immediate: true })

function toStoryboardItem(shot: Shot, index: number): StoryboardItem {
  const beatCount = shot.beats.length
  const ready = shot.staleFields.length === 0
  const firstBeat = shot.beats[0]
  const lastBeat = shot.beats.at(-1)
  return {
    id: shot.id,
    title: `SHOT ${String(index + 1).padStart(2, '0')} · ${shot.title}`,
    revision: shot.revision,
    previewMeta: `${beatCount || 1} Beats · ${(shot.durationMs / 1000).toFixed(1)}s · ${firstBeat?.camera || '镜头属性待补充'}`,
    framing: firstBeat?.camera || '待补充',
    camera: firstBeat?.action || '待补充',
    duration: `${(shot.durationMs / 1000).toFixed(1)} 秒`,
    startFrame: shot.boundaryFrames.some((frame) => frame.role === 'start') ? '已绑定首帧' : '未绑定首帧',
    endFrame: shot.boundaryFrames.some((frame) => frame.role === 'end') ? '已绑定尾帧' : '未绑定尾帧',
    references: [
      `${new Set(shot.beats.flatMap((beat) => beat.referenceIds)).size} 个已绑定参考`,
      lastBeat?.dialogue ? '对白与节拍已同步' : '无对白镜头',
    ],
    ready,
  }
}
</script>
