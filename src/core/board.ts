/**
 * 通用棋盘几何工具
 *
 * 目标：让新游戏不必重复实现「度量 / 格子命中 / 边命中 / 顶点命中 / 区域边界」。
 * 所有函数都不依赖具体游戏规则，只依赖 BoardMetrics 与宽高。
 *
 * 边的索引顺序（方阵）：
 *   - 水平边：h*(w-1) 条，索引 = y*(w-1)+x，连接 (x,y)-(x+1,y)
 *   - 竖直边：(h-1)*w 条，索引 = h*(w-1)+y*w+x，连接 (x,y)-(x,y+1)
 *
 * 顶点索引顺序：(w+1)*(h+1) 个，索引 = y*(w+1)+x
 */

import type { BoardMetrics, BoardShape, TargetKind } from './types'

export interface SquareMetricsOptions {
  cell?: number
  pad?: number
  padLeft?: number
  padTop?: number
  padRight?: number
  padBottom?: number
  cellW?: number
  cellH?: number
  shape?: BoardShape
  targetKind?: TargetKind
}

/** 生成方阵棋盘度量；未给四边留白时沿用 pad */
export function squareMetrics(
  width: number,
  height: number,
  opts: SquareMetricsOptions = {},
): BoardMetrics {
  const cell = opts.cell ?? 48
  const cellW = opts.cellW ?? cell
  const cellH = opts.cellH ?? cell
  const basePad = opts.pad ?? Math.round(cell * 0.35)
  const padLeft = opts.padLeft ?? basePad
  const padTop = opts.padTop ?? basePad
  const padRight = opts.padRight ?? basePad
  const padBottom = opts.padBottom ?? basePad
  return {
    cell,
    pad: basePad,
    width,
    height,
    svgWidth: padLeft + width * cellW + padRight,
    svgHeight: padTop + height * cellH + padBottom,
    k: 1,
    originX: padLeft,
    originY: padTop,
    cellW,
    cellH,
    padLeft,
    padTop,
    padRight,
    padBottom,
    shape: opts.shape ?? 'square',
    targetKind: opts.targetKind ?? 'cell',
  }
}

export function originOf(m: BoardMetrics): { x: number; y: number } {
  return { x: m.originX ?? m.pad, y: m.originY ?? m.pad }
}

export function cellSizeOf(m: BoardMetrics): { w: number; h: number } {
  return { w: m.cellW ?? m.cell, h: m.cellH ?? m.cell }
}

/** 单元格左上角 */
export function cellOrigin(m: BoardMetrics, index: number): { x: number; y: number } {
  const o = originOf(m)
  const s = cellSizeOf(m)
  return { x: o.x + (index % m.width) * s.w, y: o.y + Math.floor(index / m.width) * s.h }
}

/** 单元格中心 */
export function cellCenter(m: BoardMetrics, index: number): { x: number; y: number } {
  const p = cellOrigin(m, index)
  const s = cellSizeOf(m)
  return { x: p.x + s.w / 2, y: p.y + s.h / 2 }
}

/** 点命中的单元格索引 */
export function cellAtPoint(m: BoardMetrics, x: number, y: number): number | null {
  const o = originOf(m)
  const s = cellSizeOf(m)
  const col = Math.floor((x - o.x) / s.w)
  const row = Math.floor((y - o.y) / s.h)
  if (col < 0 || row < 0 || col >= m.width || row >= m.height) return null
  return row * m.width + col
}

/* ────────────────────────── 边 ────────────────────────── */

export function horizontalEdgeCount(w: number, h: number): number {
  return w > 1 ? h * (w - 1) : 0
}

export function verticalEdgeCount(w: number, h: number): number {
  return h > 1 ? (h - 1) * w : 0
}

export function edgeCount(w: number, h: number): number {
  return horizontalEdgeCount(w, h) + verticalEdgeCount(w, h)
}

export function horizontalEdgeIndex(w: number, x: number, y: number): number {
  return y * (w - 1) + x
}

export function verticalEdgeIndex(w: number, h: number, x: number, y: number): number {
  return horizontalEdgeCount(w, h) + y * w + x
}

export function edgeCells(
  edge: number,
  w: number,
  h: number,
): { a: number; b: number; horizontal: boolean } | null {
  const hCount = horizontalEdgeCount(w, h)
  if (edge < 0) return null
  if (edge < hCount) {
    const y = Math.floor(edge / (w - 1))
    const x = edge % (w - 1)
    const a = y * w + x
    return { a, b: a + 1, horizontal: true }
  }
  const v = edge - hCount
  if (v >= verticalEdgeCount(w, h)) return null
  const y = Math.floor(v / w)
  const x = v % w
  const a = y * w + x
  return { a, b: a + w, horizontal: false }
}

/** 边中点的 SVG 坐标 */
export function edgeCenter(
  m: BoardMetrics,
  edge: number,
  w: number,
  h: number,
): { x: number; y: number } | null {
  const pair = edgeCells(edge, w, h)
  if (!pair) return null
  const a = cellCenter(m, pair.a)
  const b = cellCenter(m, pair.b)
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * 点命中的边：取距离最近的边，超过 tolerance 返回 null。
 * tolerance 默认 0.3 * 格距。
 */
export function edgeAtPoint(
  m: BoardMetrics,
  x: number,
  y: number,
  tolerance?: number,
): number | null {
  const w = m.width
  const h = m.height
  const s = cellSizeOf(m)
  const tol = tolerance ?? Math.min(s.w, s.h) * 0.3
  let best = -1
  let bestDist = Infinity

  const hCount = horizontalEdgeCount(w, h)
  for (let e = 0; e < hCount; e++) {
    const c = edgeCenter(m, e, w, h)!
    const pair = edgeCells(e, w, h)!
    const a = cellCenter(m, pair.a)
    const b = cellCenter(m, pair.b)
    const d = distToSegment(x, y, a.x, a.y, b.x, b.y)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
    void c
  }
  const vCount = verticalEdgeCount(w, h)
  for (let k = 0; k < vCount; k++) {
    const e = hCount + k
    const pair = edgeCells(e, w, h)!
    const a = cellCenter(m, pair.a)
    const b = cellCenter(m, pair.b)
    const d = distToSegment(x, y, a.x, a.y, b.x, b.y)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  return bestDist <= tol ? best : null
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/* ────────────────────────── 顶点 ────────────────────────── */

export function vertexCount(w: number, h: number): number {
  return (w + 1) * (h + 1)
}

export function vertexIndex(w: number, x: number, y: number): number {
  return y * (w + 1) + x
}

export function vertexAtPoint(
  m: BoardMetrics,
  x: number,
  y: number,
  tolerance?: number,
): number | null {
  const w = m.width
  const h = m.height
  const o = originOf(m)
  const s = cellSizeOf(m)
  const tol = tolerance ?? Math.min(s.w, s.h) * 0.3
  const gx = Math.round((x - o.x) / s.w)
  const gy = Math.round((y - o.y) / s.h)
  if (gx < 0 || gy < 0 || gx > w || gy > h) return null
  const vx = o.x + gx * s.w
  const vy = o.y + gy * s.h
  if (Math.hypot(x - vx, y - vy) > tol) return null
  return vertexIndex(w, gx, gy)
}

export function vertexCenter(
  m: BoardMetrics,
  vertex: number,
): { x: number; y: number } {
  const o = originOf(m)
  const s = cellSizeOf(m)
  const w = m.width
  const gx = vertex % (w + 1)
  const gy = Math.floor(vertex / (w + 1))
  return { x: o.x + gx * s.w, y: o.y + gy * s.h }
}

/* ────────────────────────── 区域边界 ────────────────────────── */

export interface BoundarySegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * 区域粗边界线段（SVG 坐标）。regions 每格一个区域号。
 * 相同区域的相邻格之间不画线。
 */
export function regionBoundarySegments(
  m: BoardMetrics,
  regions: ArrayLike<number>,
): BoundarySegment[] {
  const w = m.width
  const h = m.height
  const o = originOf(m)
  const s = cellSizeOf(m)
  const out: BoundarySegment[] = []
  const seen = new Set<string>()
  const add = (x1: number, y1: number, x2: number, y2: number): void => {
    const key = `${x1.toFixed(1)},${y1.toFixed(1)},${x2.toFixed(1)},${y2.toFixed(1)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ x1, y1, x2, y2 })
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const region = regions[i] ?? -1
      const x0 = o.x + x * s.w
      const y0 = o.y + y * s.h
      const left = x > 0 ? (regions[i - 1] ?? -1) : null
      const up = y > 0 ? (regions[i - w] ?? -1) : null
      const right = x + 1 < w ? (regions[i + 1] ?? -1) : null
      const down = y + 1 < h ? (regions[i + w] ?? -1) : null
      if (left === null || left !== region) add(x0, y0, x0, y0 + s.h)
      if (up === null || up !== region) add(x0, y0, x0 + s.w, y0)
      if (right === null || right !== region) add(x0 + s.w, y0, x0 + s.w, y0 + s.h)
      if (down === null || down !== region) add(x0, y0 + s.h, x0 + s.w, y0 + s.h)
    }
  }
  return out
}

/** 区域配色（按区域号循环） */
export const REGION_PALETTE = [
  'hsl(150 32% 93%)',
  'hsl(35 44% 93%)',
  'hsl(210 36% 93%)',
  'hsl(280 28% 94%)',
  'hsl(0 36% 94%)',
  'hsl(180 30% 92%)',
  'hsl(60 36% 93%)',
  'hsl(320 26% 94%)',
  'hsl(105 26% 93%)',
  'hsl(15 40% 93%)',
  'hsl(240 24% 94%)',
  'hsl(195 32% 92%)',
]

export function regionFill(region: number): string {
  return REGION_PALETTE[
    ((region % REGION_PALETTE.length) + REGION_PALETTE.length) % REGION_PALETTE.length
  ]!
}
