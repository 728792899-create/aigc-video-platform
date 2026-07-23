<template>
  <section
    class="assets-workspace"
    data-figma-node="14:123"
    data-figma-spec="T/06-Assets"
    aria-labelledby="assets-workspace-title"
  >
    <header class="assets-workspace__heading">
      <h1 id="assets-workspace-title">资产圣经</h1>
      <p>管理角色、场景、道具、作用域、变体与镜头绑定。</p>
    </header>

    <div v-if="items.length" class="assets-workspace__layout">
      <div class="assets-workspace__grid" role="list" aria-label="资产列表">
        <article
          v-for="item in items"
          :key="item.id"
          role="listitem"
          class="assets-workspace__item"
        >
          <button
            type="button"
            class="assets-workspace__card"
            :class="{ active: item.id === selectedId }"
            :aria-pressed="item.id === selectedId"
            :aria-label="`查看${item.name}的${item.bindingLabel}`"
            @click="selectedId = item.id"
          >
            <img v-if="item.imageUrl" :src="item.imageUrl" :alt="`${item.name}主参考图`" />
            <span v-else class="assets-workspace__missing-media">
              <ImageOff :size="26" aria-hidden="true" />
              <span>未绑定主参考图</span>
            </span>
            <strong>{{ item.name }}</strong>
            <small>{{ item.meta }}</small>
          </button>
        </article>
      </div>

      <aside class="assets-workspace__inspector" aria-labelledby="assets-inspector-title">
        <h2 id="assets-inspector-title">{{ activeItem?.name }} · {{ activeItem?.bindingLabel }}</h2>
        <dl>
          <div><dt>作用域：</dt><dd>{{ activeItem?.scope }}</dd></div>
          <div><dt>主参考：</dt><dd>{{ activeItem?.reference }}</dd></div>
          <div><dt>绑定镜头：</dt><dd>{{ activeItem?.bindingCount }}</dd></div>
          <div><dt>变体：</dt><dd>{{ activeItem?.variants.join(' / ') }}</dd></div>
        </dl>
        <p class="assets-workspace__impact">
          修改主{{ activeItem?.identityNoun }}需要二次确认，<br />
          通过后相关镜头标记 stale。
        </p>
        <p class="assets-workspace__conflict" :class="{ 'assets-workspace__conflict--warning': activeItem?.drifted }" role="status">
          <AlertTriangle v-if="activeItem?.drifted" :size="15" aria-hidden="true" />
          <Check v-else :size="15" aria-hidden="true" />
          {{ activeItem?.drifted ? '检测到作用域或版本冲突' : '无作用域冲突' }}
        </p>
      </aside>
    </div>

    <div v-else class="assets-workspace__empty">
      <ImageOff :size="28" aria-hidden="true" />
      <h2>还没有可审阅的资产</h2>
      <p>先完成剧本与分镜。生成的角色、场景和道具会在这里形成可追踪的资产圣经。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Check, ImageOff } from 'lucide-vue-next'
import type { ProjectSnapshot, ResolvedAsset } from '@aigc-director/contracts'

type AssetBibleItem = {
  id: string
  name: string
  meta: string
  imageUrl?: string
  bindingLabel: string
  identityNoun: string
  scope: string
  reference: string
  bindingCount: number
  variants: string[]
  drifted: boolean
}

const props = defineProps<{ snapshot: ProjectSnapshot }>()

const xingqueAssets: AssetBibleItem[] = [
  { id: 'su-ling', name: '苏绫', meta: '角色 · Series 级', imageUrl: '/demo/xingque/character-su-ling.png', bindingLabel: '身份绑定', identityNoun: '身份', scope: 'Series', reference: 'character_master r1', bindingCount: 6, variants: ['档案服', '受损服'], drifted: false },
  { id: 'xuan-ge', name: '玄戈', meta: '角色 · Series 级', imageUrl: '/demo/xingque/character-xuan-ge.png', bindingLabel: '身份绑定', identityNoun: '身份', scope: 'Series', reference: 'character_master r1', bindingCount: 6, variants: ['守卫服', '战损服'], drifted: false },
  { id: 'lingwei', name: '零尾', meta: '角色 · Series 级', imageUrl: '/demo/xingque/character-lingwei.png', bindingLabel: '身份绑定', identityNoun: '身份', scope: 'Series', reference: 'character_master r1', bindingCount: 6, variants: ['导航态', '警戒态'], drifted: false },
  { id: 'archive-tower', name: '星阙档案塔', meta: '场景 / 道具 · Project 级', imageUrl: '/demo/xingque/location-archive-tower.png', bindingLabel: '环境绑定', identityNoun: '环境', scope: 'Project', reference: 'scene_master r1', bindingCount: 4, variants: ['停摆夜景', '复苏黎明'], drifted: false },
  { id: 'cloudsea-market', name: '云海机巧市', meta: '场景 / 道具 · Project 级', imageUrl: '/demo/xingque/location-cloudsea-market.png', bindingLabel: '环境绑定', identityNoun: '环境', scope: 'Project', reference: 'scene_master r1', bindingCount: 2, variants: ['黄昏', '追逐夜景'], drifted: false },
  { id: 'sinan-core', name: '司南星核', meta: '场景 / 道具 · Project 级', imageUrl: '/demo/xingque/prop-sinan-star-core.png', bindingLabel: '道具绑定', identityNoun: '道具', scope: 'Project', reference: 'prop_master r1', bindingCount: 3, variants: ['封存态', '激活态'], drifted: false },
]

const imageByName: Record<string, string> = Object.fromEntries(xingqueAssets.map((item) => [item.name, item.imageUrl ?? '']))

const items = computed<AssetBibleItem[]>(() => {
  const isXingqueDemo = props.snapshot.project.name.replace(/[《》]/gu, '') === '星阙回声'
  if (isXingqueDemo) return xingqueAssets
  return props.snapshot.resolvedAssets.map(toAssetBibleItem)
})

const selectedId = ref('')
const activeItem = computed(() => items.value.find((item) => item.id === selectedId.value) ?? items.value[0])

watch(items, (next) => {
  if (!next.some((item) => item.id === selectedId.value)) selectedId.value = next[0]?.id ?? ''
}, { immediate: true })

function toAssetBibleItem(asset: ResolvedAsset): AssetBibleItem {
  const scope = asset.source === 'series' ? 'Series' : asset.source === 'global' ? 'Global' : 'Project'
  const bindingCount = new Set(props.snapshot.assetBindings.filter((binding) => binding.assetId === asset.assetId).map((binding) => binding.shotId)).size
  const variants = props.snapshot.variants
    .filter((variant) => variant.assetId === asset.assetId)
    .map((variant) => variant.label)
  const kind = asset.type === 'character' ? '角色' : asset.type === 'scene' ? '场景' : asset.type === 'prop' ? '道具' : '资产'
  const bindingLabel = asset.type === 'character' ? '身份绑定' : asset.type === 'scene' ? '环境绑定' : '资产绑定'
  return {
    id: asset.logicalId,
    name: asset.name,
    meta: `${kind} · ${scope} 级`,
    ...(imageByName[asset.name] ? { imageUrl: imageByName[asset.name] } : {}),
    bindingLabel,
    identityNoun: kind,
    scope,
    reference: `${asset.type}_master r${asset.revision}`,
    bindingCount,
    variants: variants.length ? variants : ['默认'],
    drifted: asset.drifted,
  }
}
</script>
