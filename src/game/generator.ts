/**
 * 温度计题库生成器
 *
 * 1. 每行切成若干段横向温度计（球端在左）；
 * 2. 每支随机选择从球端开始的注水前缀；
 * 3. 计算行列和，用求解器统计解数，只保留恰好一解。
 */

import type { Difficulty } from '../core/types'
import { FILLED, MARK, encodeBoard, encodeCells } from './types.ts'
import { solveByRules } from './rules.ts'
import { countSolutions } from './solver.ts'

export interface RawPuzzleOut {
  id: string
  name: string
  width: number
  height: number
  difficulty: Difficulty
  series: string
  board: string
  solution: string
}

interface GenSpec {
  w: number
  h: number
  seed: number
  difficulty: Difficulty
  name: string
  series: string
  attempts: number
  maxNodes: number
  requireLogic: boolean
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface AttemptStats {
  notUnique: number
  timeout: number
  empty: number
}

function attemptPuzzle(
  spec: GenSpec,
  rng: () => number,
  stats: AttemptStats,
): {
  thermometers: number[][]
  rowSums: number[]
  colSums: number[]
  solution: number[]
} | null {
  const { w, h } = spec

  // 基准：每行一支横向温度计；行和直接决定每行的注水前缀，解必然唯一。
  let thermometers: number[][] = []
  const cells = new Array<number>(w * h).fill(MARK)
  for (let y = 0; y < h; y++) {
    const path: number[] = []
    for (let x = 0; x < w; x++) path.push(y * w + x)
    thermometers.push(path)
    const filled = Math.floor(rng() * (w + 1))
    for (let k = 0; k < filled; k++) cells[y * w + k] = FILLED
  }

  let filledTotal = 0
  for (const v of cells) if (v === FILLED) filledTotal++
  if (filledTotal === 0 || filledTotal === w * h) {
    stats.empty++
    return null
  }

  const rowSums = new Array<number>(h).fill(0)
  const colSums = new Array<number>(w).fill(0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x] === FILLED) {
        rowSums[y]!++
        colSums[x]!++
      }
    }
  }

  // 逐步拆分温度计，只保留仍然唯一的拆法。
  const targetCount = Math.min(w * h, Math.max(w, Math.floor(w * h * 0.35)))
  let tries = 0
  while (thermometers.length < targetCount && tries < 600) {
    tries++
    const idx = Math.floor(rng() * thermometers.length)
    const path = thermometers[idx]!
    if (path.length < 2) continue
    const cut = 1 + Math.floor(rng() * (path.length - 1))
    const first = path.slice(0, cut)
    const second = path.slice(cut)
    const backup = thermometers
    thermometers = [
      ...thermometers.slice(0, idx),
      first,
      second,
      ...thermometers.slice(idx + 1),
    ]
    const counted = countSolutions(
      thermometers,
      rowSums,
      colSums,
      w * h,
      w,
      h,
      2,
      spec.maxNodes,
    )
    if (counted.timedOut) {
      stats.timeout++
      return null
    }
    if (counted.count !== 1) {
      thermometers = backup
    }
  }

  const counted = countSolutions(thermometers, rowSums, colSums, w * h, w, h, 2, spec.maxNodes)
  if (counted.timedOut) {
    stats.timeout++
    return null
  }
  if (counted.count !== 1) {
    stats.notUnique++
    return null
  }

  if (spec.requireLogic) {
    const rules = solveByRules(
      thermometers,
      rowSums,
      colSums,
      w * h,
      w,
      h,
      true,
      240,
    )
    if (!rules.ok || !rules.saturated) {
      // 仍然可用；check 会给出警告
    }
  }

  return { thermometers, rowSums, colSums, solution: cells }
}

const SPECS: GenSpec[] = [
  {
    w: 6,
    h: 6,
    seed: 0x54484501,
    difficulty: 'easy',
    name: '初温六度',
    series: '入门',
    attempts: 600,
    maxNodes: 60_000,
    requireLogic: true,
  },
  {
    w: 7,
    h: 7,
    seed: 0x54484502,
    difficulty: 'easy',
    name: '七管升温',
    series: '入门',
    attempts: 800,
    maxNodes: 90_000,
    requireLogic: true,
  },
  {
    w: 8,
    h: 8,
    seed: 0x54484503,
    difficulty: 'medium',
    name: '水银回廊',
    series: '进阶',
    attempts: 1000,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 8,
    h: 8,
    seed: 0x54484504,
    difficulty: 'medium',
    name: '冷热交界',
    series: '进阶',
    attempts: 1200,
    maxNodes: 120_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    seed: 0x54484505,
    difficulty: 'hard',
    name: '十管齐下',
    series: '挑战',
    attempts: 1500,
    maxNodes: 180_000,
    requireLogic: false,
  },
  {
    w: 10,
    h: 10,
    seed: 0x54484506,
    difficulty: 'hard',
    name: '沸点终局',
    series: '挑战',
    attempts: 1800,
    maxNodes: 200_000,
    requireLogic: false,
  },
]

export function generatePuzzles(): RawPuzzleOut[] {
  const out: RawPuzzleOut[] = []
  for (const spec of SPECS) {
    const rng = mulberry32(spec.seed)
    const stats: AttemptStats = { notUnique: 0, timeout: 0, empty: 0 }
    let made: {
      thermometers: number[][]
      rowSums: number[]
      colSums: number[]
      solution: number[]
    } | null = null
    const t0 = Date.now()
    for (let attempt = 0; attempt < spec.attempts; attempt++) {
      made = attemptPuzzle(spec, rng, stats)
      if (made) break
    }
    if (!made) {
      console.error(`[温度计 gen] ${spec.name} 失败统计：`, stats)
      throw new Error(`[温度计 gen] ${spec.name} 在 ${spec.attempts} 次尝试内没有生成唯一解题`)
    }
    const filled = made.solution.filter((v) => v === FILLED).length
    console.log(
      `[温度计 gen] ${spec.name} ${spec.w}×${spec.h}：温度计 ${made.thermometers.length}，注水 ${filled}，${Date.now() - t0}ms`,
    )
    out.push({
      id: `thermometer-${spec.w}x${spec.h}-${spec.seed.toString(36)}`,
      name: spec.name,
      width: spec.w,
      height: spec.h,
      difficulty: spec.difficulty,
      series: spec.series,
      board: encodeBoard(made.thermometers, made.rowSums, made.colSums),
      solution: encodeCells(made.solution),
    })
  }
  return out
}
