import { useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type {
  AppStatus,
  AppWorkload,
  BucketInfo,
  DatabaseDetail,
  ProjectLink,
  VolumeHint
} from '../../../shared/types'
import { STATUS_LABEL, dbPhaseToStatus, iconAttrs, openUrl, statusDotClass } from './detailUtils'

const NODE_W = 268
const NODE_H = 128
const GAP_X = 36
const GAP_Y = 22
const LAYER_GAP = 76
const COLS = 4
const EDGE_STROKE = '#c8c8c6'

const POLICY_LABEL: Record<string, string> = {
  private: '私有',
  publicRead: '公开读',
  publicReadwrite: '公开读写'
}

type AppNodeData = {
  name: string
  status: AppStatus
  subtitle: string
  urls: string[]
  meta: string
  volume?: VolumeHint
  onOpen: () => void
}

type DbNodeData = {
  name: string
  status: AppStatus
  engine: string
  volume?: VolumeHint
  onOpen: () => void
}

type BucketNodeData = {
  name: string
  policy: string
  bucketName?: string
}

type AppTopoNode = Node<AppNodeData, 'app'>
type DbTopoNode = Node<DbNodeData, 'database'>
type BucketTopoNode = Node<BucketNodeData, 'bucket'>
type TopologyNode = AppTopoNode | DbTopoNode | BucketTopoNode

function hostOf(url: string): string {
  return url.replace(/^https:\/\//, '')
}

function shortImage(image?: string): string {
  return image?.replace(/^docker\.io\//, '') ?? ''
}

function engineLabel(engine?: string, version?: string): string {
  if (!engine) return '数据库'
  const ver = version?.replace(`${engine}-`, '') ?? ''
  return ver ? `${engine} ${ver}` : engine
}

function engineTone(engine?: string): string {
  const e = (engine ?? '').toLowerCase()
  if (e.includes('postgres') || e === 'pg' || e.includes('postgresql')) return 'topo-tone-pg'
  if (e.includes('mysql') || e.includes('mariadb')) return 'topo-tone-mysql'
  if (e.includes('mongo')) return 'topo-tone-mongo'
  if (e.includes('redis')) return 'topo-tone-redis'
  if (e.includes('kafka') || e.includes('broker')) return 'topo-tone-kafka'
  return ''
}

function layoutGrid(count: number, originY: number): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / COLS)
    const col = i % COLS
    const rowCount = Math.min(COLS, count - row * COLS)
    const rowWidth = rowCount * NODE_W + (rowCount - 1) * GAP_X
    positions.push({
      x: -rowWidth / 2 + col * (NODE_W + GAP_X),
      y: originY + row * (NODE_H + GAP_Y)
    })
  }
  return positions
}

function layerHeight(count: number): number {
  if (count === 0) return 0
  const rows = Math.ceil(count / COLS)
  return rows * NODE_H + (rows - 1) * GAP_Y
}

function CubeIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs(16)}>
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
      <path d="m4 8 8 4.5L20 8M12 12.5v8" />
    </svg>
  )
}

function CylIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs(16)}>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v12c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6V6" />
      <path d="M5 12c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6" />
    </svg>
  )
}

function BucketIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs(16)}>
      <path d="M4.5 8h15l-1.4 10.2A2 2 0 0 1 16.12 20H7.88a2 2 0 0 1-1.98-1.8L4.5 8Z" />
      <path d="M8 8V6.5A4 4 0 0 1 12 2.5 4 4 0 0 1 16 6.5V8" />
    </svg>
  )
}

function DiskIcon(): React.JSX.Element {
  return (
    <svg {...iconAttrs(13)}>
      <rect x="4" y="5" width="16" height="13" rx="2" />
      <path d="M8 5V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v1M8 12h8" />
    </svg>
  )
}

function VolumeFoot({ volume }: { volume: VolumeHint }): React.JSX.Element {
  return (
    <div className="topo-node-foot">
      <DiskIcon />
      <span className="truncate" title={volume.name}>
        {volume.name}
      </span>
      {volume.size && <span className="topo-node-size">{volume.size}</span>}
    </div>
  )
}

function AppNode({ data }: NodeProps<AppTopoNode>): React.JSX.Element {
  return (
    <div className="topo-node topo-node-click">
      <Handle
        type="source"
        position={Position.Bottom}
        className="topo-handle"
        isConnectable={false}
      />
      <div className="topo-node-main">
        <span className="topo-node-ico topo-tone-app">
          <CubeIcon />
        </span>
        <div className="topo-node-text">
          <div className="topo-node-name truncate" title={data.name}>
            {data.name}
          </div>
          {data.urls[0] ? (
            <button
              type="button"
              className="topo-node-url nodrag nopan truncate"
              title={data.urls.join('\n')}
              onClick={(event) => {
                event.stopPropagation()
                openUrl(data.urls[0])
              }}
            >
              {hostOf(data.urls[0])}
              {data.urls.length > 1 ? ` +${data.urls.length - 1}` : ''}
            </button>
          ) : (
            <div className="topo-node-sub mono truncate" title={data.subtitle}>
              {data.subtitle || '无公网域名'}
            </div>
          )}
        </div>
      </div>
      <div className="topo-node-status">
        <span className={statusDotClass(data.status)} />
        <span>{STATUS_LABEL[data.status]}</span>
        {data.meta && <span className="topo-node-meta">{data.meta}</span>}
      </div>
      {data.volume && <VolumeFoot volume={data.volume} />}
    </div>
  )
}

function DbNode({ data }: NodeProps<DbTopoNode>): React.JSX.Element {
  return (
    <div className="topo-node topo-node-click">
      <Handle type="target" position={Position.Top} className="topo-handle" isConnectable={false} />
      <div className="topo-node-main">
        <span className={`topo-node-ico ${engineTone(data.engine)}`}>
          <CylIcon />
        </span>
        <div className="topo-node-text">
          <div className="topo-node-name truncate" title={data.name}>
            {data.name}
          </div>
          <div className="topo-node-sub truncate">{data.engine}</div>
        </div>
      </div>
      <div className="topo-node-status">
        <span className={statusDotClass(data.status)} />
        <span>{STATUS_LABEL[data.status]}</span>
      </div>
      {data.volume && <VolumeFoot volume={data.volume} />}
    </div>
  )
}

function BucketNode({ data }: NodeProps<BucketTopoNode>): React.JSX.Element {
  return (
    <div className="topo-node">
      <Handle type="target" position={Position.Top} className="topo-handle" isConnectable={false} />
      <div className="topo-node-main">
        <span className="topo-node-ico topo-tone-bucket">
          <BucketIcon />
        </span>
        <div className="topo-node-text">
          <div className="topo-node-name truncate" title={data.name}>
            {data.name}
          </div>
          <div className="topo-node-sub truncate" title={data.bucketName}>
            {data.bucketName ?? data.policy}
          </div>
        </div>
      </div>
      <div className="topo-node-status">
        <span className="dot dot-running" />
        <span>{data.policy}</span>
      </div>
    </div>
  )
}

const nodeTypes = {
  app: AppNode,
  database: DbNode,
  bucket: BucketNode
}

function makeEdge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    selectable: false,
    focusable: false,
    style: { stroke: EDGE_STROKE, strokeWidth: 1.5, strokeDasharray: '6 5' },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: EDGE_STROKE
    }
  }
}

interface Props {
  apps: AppWorkload[]
  databases: DatabaseDetail[]
  buckets: BucketInfo[]
  links: ProjectLink[]
  onOpenApp: (name: string, kind: 'Deployment' | 'StatefulSet') => void
  onOpenDatabase: (name: string) => void
}

function ProjectTopology({
  apps,
  databases,
  buckets,
  links,
  onOpenApp,
  onOpenDatabase
}: Props): React.JSX.Element {
  const deps = [...databases, ...buckets]
  const appH = layerHeight(apps.length)
  const depH = layerHeight(deps.length)
  const gap = apps.length > 0 && deps.length > 0 ? LAYER_GAP : 0
  const height = Math.min(520, Math.max(268, appH + gap + depH + 56))

  const { nodes, edges } = useMemo(() => {
    const appPos = layoutGrid(apps.length, 0)
    const depPos = layoutGrid(deps.length, appH + gap)
    const nextNodes: TopologyNode[] = []

    apps.forEach((app, i) => {
      const pos = appPos[i]
      nextNodes.push({
        id: `app:${app.name}`,
        type: 'app',
        position: pos,
        className: 'nopan topo-rf-app',
        draggable: false,
        selectable: false,
        style: { width: NODE_W },
        data: {
          name: app.name,
          status: app.status,
          subtitle: shortImage(app.images[0]),
          urls: app.urls,
          meta: `${app.readyReplicas}/${app.replicas} · ${app.kind === 'StatefulSet' ? '有状态' : '无状态'}`,
          volume: app.volume,
          onOpen: () => onOpenApp(app.name, app.kind)
        }
      })
    })

    databases.forEach((db, i) => {
      nextNodes.push({
        id: `db:${db.name}`,
        type: 'database',
        position: depPos[i],
        className: 'nopan topo-rf-app',
        draggable: false,
        selectable: false,
        style: { width: NODE_W },
        data: {
          name: db.name,
          status: dbPhaseToStatus(db.phase),
          engine: engineLabel(db.engine, db.version),
          volume: db.volume,
          onOpen: () => onOpenDatabase(db.name)
        }
      })
    })

    buckets.forEach((bucket, i) => {
      nextNodes.push({
        id: `bucket:${bucket.name}`,
        type: 'bucket',
        position: depPos[databases.length + i],
        className: 'nopan',
        draggable: false,
        selectable: false,
        style: { width: NODE_W },
        data: {
          name: bucket.name,
          policy: POLICY_LABEL[bucket.policy ?? ''] ?? bucket.policy ?? '对象存储',
          bucketName: bucket.bucketName
        }
      })
    })

    const appSet = new Set(apps.map((app) => app.name))
    const dbSet = new Set(databases.map((db) => db.name))
    const bucketSet = new Set(buckets.map((bucket) => bucket.name))
    const nextEdges: Edge[] = []
    for (const link of links) {
      if (!appSet.has(link.app)) continue
      if (link.targetKind === 'database' && dbSet.has(link.target)) {
        nextEdges.push(
          makeEdge(`e-${link.app}-db-${link.target}`, `app:${link.app}`, `db:${link.target}`)
        )
      }
      if (link.targetKind === 'bucket' && bucketSet.has(link.target)) {
        nextEdges.push(
          makeEdge(
            `e-${link.app}-bucket-${link.target}`,
            `app:${link.app}`,
            `bucket:${link.target}`
          )
        )
      }
    }

    return { nodes: nextNodes, edges: nextEdges }
  }, [apps, databases, buckets, links, onOpenApp, onOpenDatabase, appH, gap, deps.length])

  // xyflow：节点既不可选也不可拖、又没有 onNodeClick 时，wrapper 会设
  // pointer-events:none，卡片内部的 onClick（含公网链接）全部点不透。
  const openNode = (_event: React.MouseEvent, node: TopologyNode): void => {
    if (node.type === 'app' || node.type === 'database') node.data.onOpen()
  }

  return (
    <div className="topo-wrap" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode="light"
        fitView
        fitViewOptions={{ padding: 0.22, minZoom: 0.35, maxZoom: 1 }}
        minZoom={0.35}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        onNodeClick={openNode}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.1} color="#d4d4d2" />
        <Controls showZoom={false} showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  )
}

export default ProjectTopology
