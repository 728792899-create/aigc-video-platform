import { Graph, layout } from '@dagrejs/dagre'
import { MarkerType, type Edge, type Node, type XYPosition } from '@vue-flow/core'

import type { StudioGraph, StudioGraphNode } from './studioGraph'

export interface StudioCanvasNodeData extends Record<string, unknown> {
  stage: StudioGraphNode
}

export type StudioCanvasNode = Node<StudioCanvasNodeData>
export type StudioCanvasEdge = Edge<Record<string, unknown>>
export type StudioPositionMap = Record<string, XYPosition>

const NODE_WIDTH = 264
const NODE_HEIGHT = 156

export function layoutStudioGraph(
  graph: StudioGraph,
  positions: StudioPositionMap = {},
): { nodes: StudioCanvasNode[]; edges: StudioCanvasEdge[] } {
  const dagre = new Graph({ multigraph: false, compound: false })
    .setGraph({
      rankdir: 'LR',
      ranksep: 100,
      nodesep: 54,
      edgesep: 28,
      marginx: 48,
      marginy: 48,
      acyclicer: 'greedy',
      ranker: 'network-simplex',
    })
    .setDefaultEdgeLabel(() => ({}))

  for (const node of graph.nodes) dagre.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const edge of graph.edges) dagre.setEdge(edge.source, edge.target)
  layout(dagre)

  const nodes: StudioCanvasNode[] = graph.nodes.map((stage) => {
    const point = dagre.node(stage.id) as { x: number; y: number }
    return {
      id: stage.id,
      type: 'studio-stage',
      position: positions[stage.id] ?? {
        x: point.x - NODE_WIDTH / 2,
        y: point.y - NODE_HEIGHT / 2,
      },
      data: { stage },
      draggable: true,
      selectable: true,
      focusable: true,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }
  })

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const edges: StudioCanvasEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
    animated: byId.get(edge.target)?.status === 'running',
    class: `studio-edge studio-edge--${edge.state}`,
    markerEnd: MarkerType.ArrowClosed,
    style: { strokeWidth: 1.6 },
  }))

  return { nodes, edges }
}

export function collectStudioPositions(nodes: Array<{ id: string; position: XYPosition }>): StudioPositionMap {
  return Object.fromEntries(nodes.map((node) => [node.id, { x: node.position.x, y: node.position.y }]))
}
