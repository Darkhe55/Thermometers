/**
 * 温度计 —— 实时校验
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { isValidSolution } from './rules'
import {
  asThermoPuzzle,
  asThermoState,
  EMPTY,
  FILLED,
  MARK,
  type LineIssue,
  type ThermoResult,
} from './types'

export function validate(state: GameState, puzzle: Puzzle): ThermoResult {
  const s = asThermoState(state)
  const p = asThermoPuzzle(puzzle)
  const w = s.width
  const h = s.height
  const size = w * h
  const cells = s.cells
  const thermometers = p.thermometers ?? []
  const rowSums = p.rowSums ?? []
  const colSums = p.colSums ?? []

  let empty = 0
  let filled = 0
  for (let i = 0; i < size; i++) {
    if (cells[i] === EMPTY) empty++
    else if (cells[i] === FILLED) filled++
  }

  const bad = new Set<number>()
  const prefixIssues: number[] = []

  for (let t = 0; t < thermometers.length; t++) {
    const path = thermometers[t]!
    let seenMark = false
    let badPath = false
    for (const cell of path) {
      if (cells[cell] === MARK) seenMark = true
      else if (cells[cell] === FILLED && seenMark) badPath = true
    }
    if (badPath) {
      prefixIssues.push(t)
      for (const cell of path) bad.add(cell)
    }
  }

  const sumIssues: LineIssue[] = []
  for (let y = 0; y < h; y++) {
    const target = rowSums[y] ?? 0
    let count = 0
    let unknown = 0
    for (let x = 0; x < w; x++) {
      const v = cells[y * w + x]
      if (v === FILLED) count++
      else if (v === EMPTY) unknown++
    }
    if (count > target || count + unknown < target || (unknown === 0 && count !== target)) {
      sumIssues.push({ orientation: 'row', index: y, filled: count, target })
      if (unknown === 0 || count + unknown < target) {
        for (let x = 0; x < w; x++) bad.add(y * w + x)
      }
    }
  }
  for (let x = 0; x < w; x++) {
    const target = colSums[x] ?? 0
    let count = 0
    let unknown = 0
    for (let y = 0; y < h; y++) {
      const v = cells[y * w + x]
      if (v === FILLED) count++
      else if (v === EMPTY) unknown++
    }
    if (count > target || count + unknown < target || (unknown === 0 && count !== target)) {
      sumIssues.push({ orientation: 'col', index: x, filled: count, target })
      if (unknown === 0 || count + unknown < target) {
        for (let y = 0; y < h; y++) bad.add(y * w + x)
      }
    }
  }

  // 未定格的推断：落在注水前缀之后的一律视为空，落在前缀之内的未知格说明还没解完
  const normalized = cells.map((v) => (v === FILLED ? FILLED : MARK))
  const solved =
    prefixIssues.length === 0 &&
    sumIssues.length === 0 &&
    isValidSolution(normalized, thermometers, rowSums, colSums, w, h)

  return {
    solved,
    empty,
    complete: empty === 0,
    filled,
    prefixIssues,
    sumIssues,
    badCells: Array.from(bad),
  }
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as ThermoResult
  if (r.solved) return ['完成']

  const bits: string[] = []
  if (typeof r.empty === 'number' && r.empty > 0) bits.push(`还需填 ${r.empty} 格`)
  if (r.prefixIssues.length > 0) bits.push(`${r.prefixIssues.length} 支温度计注水不连续`)
  if (r.sumIssues.length > 0) {
    const rows = r.sumIssues.filter((x) => x.orientation === 'row').length
    const cols = r.sumIssues.length - rows
    if (rows > 0) bits.push(`${rows} 行数字不满足`)
    if (cols > 0) bits.push(`${cols} 列数字不满足`)
  }
  if (bits.length === 0) bits.push('继续注水')
  return bits
}
