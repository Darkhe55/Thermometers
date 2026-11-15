/**
 * 温度计 —— 规则引擎
 */

import { EMPTY, FILLED, MARK } from './types.ts'

export type RuleKind = 'thermo' | 'sum'

export type SetCallback = (index: number, value: number, rule: RuleKind) => void

export function propagate(
  cells: Int8Array | number[],
  thermometers: number[][],
  rowSums: number[],
  colSums: number[],
  w: number,
  h: number,
  onSet?: SetCallback,
): boolean {
  let changed = true

  const set = (i: number, value: number, kind: RuleKind): boolean => {
    if (cells[i] === value) return true
    if (cells[i] !== EMPTY) return false
    cells[i] = value
    onSet?.(i, value, kind)
    changed = true
    return true
  }

  while (changed) {
    changed = false

    // 温度计：注水必须是球端开始的前缀
    for (const path of thermometers) {
      let firstMark = -1
      let lastFilled = -1
      for (let i = 0; i < path.length; i++) {
        const cell = path[i]!
        if (cells[cell] === MARK && firstMark < 0) firstMark = i
        if (cells[cell] === FILLED) lastFilled = i
      }
      if (firstMark >= 0 && lastFilled > firstMark) return false

      for (let i = 0; i <= lastFilled; i++) {
        const cell = path[i]!
        if (cells[cell] === MARK) return false
        if (cells[cell] === EMPTY && !set(cell, FILLED, 'thermo')) return false
      }
      if (firstMark >= 0) {
        for (let i = firstMark; i < path.length; i++) {
          const cell = path[i]!
          if (cells[cell] === FILLED) return false
          if (cells[cell] === EMPTY && !set(cell, MARK, 'thermo')) return false
        }
      }
    }

    // 行和
    for (let y = 0; y < h; y++) {
      const target = rowSums[y] ?? 0
      let filled = 0
      const unknown: number[] = []
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cells[i] === FILLED) filled++
        else if (cells[i] === EMPTY) unknown.push(i)
      }
      if (filled > target) return false
      if (filled + unknown.length < target) return false
      if (filled === target) {
        for (const i of unknown) if (!set(i, MARK, 'sum')) return false
      } else if (filled + unknown.length === target) {
        for (const i of unknown) if (!set(i, FILLED, 'sum')) return false
      }
    }

    // 列和
    for (let x = 0; x < w; x++) {
      const target = colSums[x] ?? 0
      let filled = 0
      const unknown: number[] = []
      for (let y = 0; y < h; y++) {
        const i = y * w + x
        if (cells[i] === FILLED) filled++
        else if (cells[i] === EMPTY) unknown.push(i)
      }
      if (filled > target) return false
      if (filled + unknown.length < target) return false
      if (filled === target) {
        for (const i of unknown) if (!set(i, MARK, 'sum')) return false
      } else if (filled + unknown.length === target) {
        for (const i of unknown) if (!set(i, FILLED, 'sum')) return false
      }
    }
  }

  return true
}

export function isValidSolution(
  cells: ArrayLike<number>,
  thermometers: number[][],
  rowSums: number[],
  colSums: number[],
  w: number,
  h: number,
): boolean {
  for (let i = 0; i < w * h; i++) {
    if (cells[i] !== FILLED && cells[i] !== MARK) return false
  }

  for (const path of thermometers) {
    let seenEmpty = false
    for (const cell of path) {
      if (cells[cell] === MARK) seenEmpty = true
      else if (seenEmpty) return false
    }
  }

  for (let y = 0; y < h; y++) {
    let filled = 0
    for (let x = 0; x < w; x++) if (cells[y * w + x] === FILLED) filled++
    if (filled !== (rowSums[y] ?? 0)) return false
  }
  for (let x = 0; x < w; x++) {
    let filled = 0
    for (let y = 0; y < h; y++) if (cells[y * w + x] === FILLED) filled++
    if (filled !== (colSums[x] ?? 0)) return false
  }
  return true
}

export interface RuleSolveResult {
  ok: boolean
  solution: number[] | null
  contradiction: boolean
  saturated: boolean
  usedProbing: boolean
}

export function solveByRules(
  thermometers: number[][],
  rowSums: number[],
  colSums: number[],
  size: number,
  w: number,
  h: number,
  probing = true,
  maxRounds = 400,
): RuleSolveResult {
  const grid = new Array<number>(size).fill(EMPTY)
  let usedProbing = false

  for (let round = 0; round < maxRounds; round++) {
    if (!propagate(grid, thermometers, rowSums, colSums, w, h)) {
      return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
    }

    let unknown = -1
    for (let i = 0; i < size; i++) {
      if (grid[i] === EMPTY) {
        unknown = i
        break
      }
    }
    if (unknown < 0) {
      const solution = Array.from(grid)
      const ok = isValidSolution(solution, thermometers, rowSums, colSums, w, h)
      return {
        ok,
        solution: ok ? solution : null,
        contradiction: false,
        saturated: ok,
        usedProbing,
      }
    }

    if (!probing) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }

    usedProbing = true
    const forced: Array<{ index: number; value: number }> = []
    for (let i = 0; i < size; i++) {
      if (grid[i] !== EMPTY) continue
      let filledImpossible = false
      let markImpossible = false
      {
        const trial = Int8Array.from(grid)
        trial[i] = FILLED
        if (!propagate(trial, thermometers, rowSums, colSums, w, h)) filledImpossible = true
      }
      {
        const trial = Int8Array.from(grid)
        trial[i] = MARK
        if (!propagate(trial, thermometers, rowSums, colSums, w, h)) markImpossible = true
      }
      if (filledImpossible && markImpossible) {
        return { ok: false, solution: null, contradiction: true, saturated: false, usedProbing }
      }
      if (filledImpossible !== markImpossible) {
        forced.push({ index: i, value: filledImpossible ? MARK : FILLED })
      }
    }

    if (!forced.length) {
      return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
    }
    for (const { index, value } of forced) {
      if (grid[index] === EMPTY) grid[index] = value
    }
  }

  return { ok: false, solution: null, contradiction: false, saturated: false, usedProbing }
}
