<template>
  <div class="canvas" aria-label="AI 导演领域画布">
    <VueFlow
      :nodes="flowNodes"
      :edges="flowEdges"
      :min-zoom="0.12"
      :max-zoom="2.5"
      :fit-view-on-init="true"
      :nodes-draggable="true"
      :nodes-connectable="graph.view === 'story'"
      :elevate-nodes-on-select="true"
      @node-click="onNodeClick"
      @node-drag-stop="onNodeDragStop"
      @connect="onConnect"
      @pane-click="$emit('select', undefined)"
    >
      <Background pattern-color="var(--graph-grid)" :gap="26" :size="1" />
      <MiniMap :pannable="true" :zoomable="true" node-color="var(--graph-minimap-node)" mask-color="var(--graph-minimap-mask)" />
      <Controls position="bottom-left" />
      <template #node-domain="nodeProps">
        <GraphNodeCard v-bind="nodeProps" />
      </template>
    </VueFlow>
    <div v-if="graph.nodes.length === 0" class="canvas-empty">
      <Sparkles :size="32" />
      <h2>{{ emptyTitle }}</h2>
      <p>{{ emptyDescription }}</p>
      <slot name="empty-action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { VueFlow, type Connection, type NodeDragEvent, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { Sparkles } from 'lucide-vue-next'
import type { GraphProjection } from '@aigc-director/contracts'
import GraphNodeCard from './GraphNodeCard.vue'

const props = defineProps<{ graph: GraphProjection }>()
const emit = defineEmits<{
  select: [nodeId: string | undefined]
  move: [positions: Record<string, { x: number; y: number }>]
  connect: [source: string, target: string]
}>()

const flowNodes = computed(() => props.graph.nodes.map((node) => ({
  id: node.id, type: 'domain', position: node.position, data: { type: node.type, label: node.label, subtitle: node.subtitle, status: node.status },
})))
const flowEdges = computed(() => props.graph.edges.map((edge) => ({
  id: edge.id, source: edge.source, target: edge.target,
  ...(edge.label ? { label: edge.label } : {}),
  ...(edge.animated === undefined ? {} : { animated: edge.animated }),
  style: { stroke: edge.animated ? 'var(--graph-edge-active)' : 'var(--graph-edge)', strokeWidth: 1.5 },
})))
const emptyTitle = computed(() => props.graph.view === 'story' ? '从原著或一个想法开始' : props.graph.view === 'production' ? '先批准改编计划' : '先生成镜头候选')
const emptyDescription = computed(() => props.graph.view === 'story' ? '导入文本后，章节和事件会直接出现在这张画布上。' : '画布只展示真实领域对象，不创建静态演示节点。')

function onNodeClick(event: NodeMouseEvent): void { emit('select', event.node.id) }
function onNodeDragStop(event: NodeDragEvent): void { emit('move', { [event.node.id]: event.node.position }) }
function onConnect(connection: Connection): void { if (connection.source && connection.target) emit('connect', connection.source, connection.target) }
</script>
