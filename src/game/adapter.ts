/**
 * ════════════════════════════════════════════════════════════════════
 *  温度计（Thermometers）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：从球端连续注水；盘外数字表示该行/列注水格总数。
 *
 * 状态用 0/1/2：0 = 未定，1 = 注水，2 = 空。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { statusBits, validate } from './validate'
import {
  decodeBoard,
  decodeCells,
  encodeBoard,
  encodeCells,
  FILLED,
  MARK,
  type ThermoPuzzle,
} from './types'

const meta = {
  title: '温度计',
  tagline: '从球端一路注水 —— 行列数字告诉你这一行/列有多少水',
  footerNote:
    '规则：每支温度计从球端（第一格）开始连续注水，一旦断开就不能再注；盘外数字表示该行/列被注水的格子总数。',
  storageKeyPrefix: 'thermometer',
  customIdPrefix: 'thermometer-custom-',
  customMinW: 5,
  customMinH: 5,
  customMaxW: 35,
  customMaxH: 35,
}

const VALUE_CYCLE: Array<number | null> = [null, FILLED]

/** 旧行为：把每行连续填充段切成横向温度计（用于形状不规整时的兼容回退） */
function horizontalRuns(picture: number[], w: number, h: number): number[][] {
  const out: number[][] = []
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      if (picture[y * w + x] === FILLED) {
        const path: number[] = []
        while (x < w && picture[y * w + x] === FILLED) {
          path.push(y * w + x)
          x++
        }
        out.push(path)
      } else {
        x++
      }
    }
  }
  return out
}

/**
 * 把「画出的注水格」切成温度计：
 *   - 按上下左右连通块分组；每个连通块必须是同一行或同一列的直线，
 *     于是横线 → 横向温度计（球端在左），竖线 → 纵向温度计（球端在上）；
 *   - 出现 L 形 / 十字 / 方块等不规整形状时退回旧行为（逐行切横段），
 *     保证旧自定义题的画法仍能保存。
 */
function thermometersFromPicture(picture: number[], w: number, h: number): number[][] {
  const seen = new Uint8Array(w * h)
  const out: number[][] = []
  for (let start = 0; start < picture.length; start++) {
    if (picture[start] !== FILLED || seen[start]) continue
    // 4 邻连通块
    const comp: number[] = []
    const queue = [start]
    seen[start] = 1
    while (queue.length) {
      const i = queue.pop()!
      comp.push(i)
      const x = i % w
      const y = (i / w) | 0
      if (x > 0 && picture[i - 1] === FILLED && !seen[i - 1]) {
        seen[i - 1] = 1
        queue.push(i - 1)
      }
      if (x + 1 < w && picture[i + 1] === FILLED && !seen[i + 1]) {
        seen[i + 1] = 1
        queue.push(i + 1)
      }
      if (y > 0 && picture[i - w] === FILLED && !seen[i - w]) {
        seen[i - w] = 1
        queue.push(i - w)
      }
      if (y + 1 < h && picture[i + w] === FILLED && !seen[i + w]) {
        seen[i + w] = 1
        queue.push(i + w)
      }
    }
    const sameRow = comp.every((i) => ((i / w) | 0) === ((comp[0]! / w) | 0))
    const sameCol = comp.every((i) => i % w === comp[0]! % w)
    if (!sameRow && !sameCol) return horizontalRuns(picture, w, h)
    comp.sort((a, b) => a - b) // 行内从左到右 / 列内从上到下
    out.push(comp)
  }
  return out
}

const custom: CustomSupport = {
  mode: 'picture',
  valueCycle: VALUE_CYCLE,

  keyForDigit: (digit) => {
    if (digit === 0) return null
    if (digit === FILLED) return FILLED
    return undefined
  },

  cellLabel: (v) => (v === FILLED ? '■' : ''),

  cellClass: (v) => (v === FILLED ? 'v-filled' : ''),

  hint: '在自定义题板里画出注水答案（点格子）：横向连续格 → 横向温度计（球端在左），竖直连续格 → 纵向温度计（球端在上）。L 形等不规整画法会按逐行横段解释。',

  toGrid: (p) => {
    const solution = (p as ThermoPuzzle).solution
    if (!Array.isArray(solution) || solution.length !== p.width * p.height) return null
    return {
      width: p.width,
      height: p.height,
      grid: solution.map((v) => (v === FILLED ? FILLED : null)),
    }
  },

  makePuzzle: (w, h, grid, existingId) => {
    const picture = grid.map((v) => (v === FILLED ? FILLED : 0))
    const rowSums = new Array<number>(h).fill(0)
    const colSums = new Array<number>(w).fill(0)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (picture[y * w + x] === FILLED) {
          rowSums[y]!++
          colSums[x]!++
        }
      }
    }
    const thermometers = thermometersFromPicture(picture, w, h)
    const solution = picture.map((v) => (v === FILLED ? FILLED : MARK))
    return {
      id: existingId ?? `${meta.customIdPrefix}${w}x${h}-${Date.now()}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      thermometers,
      rowSums,
      colSums,
      solution,
    } satisfies ThermoPuzzle
  },

  encodePuzzle: (p) => {
    const tp = p as ThermoPuzzle
    return {
      board: encodeBoard(tp.thermometers ?? [], tp.rowSums ?? [], tp.colSums ?? []),
      solution: encodeCells(tp.solution ?? []),
    }
  },

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
    if (typeof record.board !== 'string') return null
    const decoded = decodeBoard(record.board, w * h, w, h)
    if (!decoded) return null
    let solution: number[] | undefined
    if (typeof record.solution === 'string') {
      const cells = decodeCells(record.solution, w * h)
      if (cells) solution = cells
    }
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      thermometers: decoded.thermometers,
      rowSums: decoded.rowSums,
      colSums: decoded.colSums,
      solution,
    } satisfies ThermoPuzzle
  },
}

function playForMove(move: Move, streak: number): void {
  if (move.to === FILLED) playPluck(streak, 1.1)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
