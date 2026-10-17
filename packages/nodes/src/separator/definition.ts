import { type NodeDefinition, SeparatorNode } from '@pascal-app/core'

export const separatorDefinition: NodeDefinition<typeof SeparatorNode> = {
  kind: 'separator',
  bake: 'strip',
  schemaVersion: 1,
  schema: SeparatorNode,
  category: 'structure',
  defaults: () => {
    const { id: _id, type: _type, ...rest } = SeparatorNode.parse({ start: [0, 0], end: [1, 0] })
    return rest
  },
  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: false,
    deletable: true,
    presettable: false,
  },
  dirtyTracking: false,
  rendersChildren: false,
  renderer: { kind: 'parametric', module: () => import('./renderer') },
  floorplan: (node, ctx) => {
    const [x1, y1] = node.start
    const [x2, y2] = node.end
    const selected = ctx.viewState?.selected === true
    return {
      kind: 'group',
      children: [
        {
          kind: 'line',
          x1,
          y1,
          x2,
          y2,
          stroke: selected ? (ctx.viewState?.palette?.selectedStroke ?? '#818cf8') : '#818cf8',
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: '6 4',
          vectorEffect: 'non-scaling-stroke',
          pointerEvents: 'none',
        },
        // A dashed 2 px line is too thin to click; this catches the pointer around it.
        { kind: 'hit-line', x1, y1, x2, y2, strokeWidthPx: 12 },
      ],
    }
  },
  presentation: {
    icon: { kind: 'iconify', name: 'lucide:split' },
    label: 'Separator',
    hidden: true,
    actionMenu: false,
  },
}
