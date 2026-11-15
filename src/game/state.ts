/**
 * 温度计 —— 棋盘状态
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import {
  asThermoPuzzle,
  asThermoState,
  decodeCells,
  EMPTY,
  encodeCells,
  FILLED,
  MARK,
  type ThermoState,
} from './types'

export function createEmptyState(puzzle: Puzzle): ThermoState {
  const p = asThermoPuzzle(puzzle)
  const size = p.width * p.height
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    cells: new Array<number>(size).fill(EMPTY),
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function cloneState(state: GameState): ThermoState {
  const s = asThermoState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: s.cells.slice(),
    givens: s.givens.slice(),
  }
}

export function cycleValue(state: GameState, target: HitTarget): number {
  const s = asThermoState(state)
  const v = s.cells[target.index] ?? EMPTY
  if (v === EMPTY) return FILLED
  if (v === FILLED) return MARK
  return EMPTY
}

export function rightClickValue(state: GameState, target: HitTarget): number {
  const s = asThermoState(state)
  return s.cells[target.index] === MARK ? EMPTY : MARK
}

export function applyMove(state: GameState, move: Move): void {
  const s = asThermoState(state)
  if (move.index < 0 || move.index >= s.cells.length) return
  s.cells[move.index] = move.to === FILLED || move.to === MARK ? move.to : EMPTY
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asThermoState(state).cells[index] ?? EMPTY
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asThermoState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    cells: encodeCells(s.cells),
  }
}

function readCells(value: unknown, size: number): number[] | null {
  if (typeof value === 'string') return decodeCells(value, size)
  if (Array.isArray(value)) {
    if (value.length !== size) return null
    const out: number[] = []
    for (const v of value) {
      const n = Number(v)
      if (n !== EMPTY && n !== FILLED && n !== MARK) return null
      out.push(n)
    }
    return out
  }
  return null
}

export function deserializeState(data: Record<string, unknown>): ThermoState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width
  const h = data.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return null
  const size = w * h
  const cells = readCells(data.cells, size)
  if (!cells) return null
  return {
    puzzleId: data.puzzleId,
    width: w,
    height: h,
    cells,
    givens: new Array<number>(size).fill(EMPTY),
  }
}

export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asThermoState(state)
  const sol = asThermoState(solution)
  const size = Math.min(s.cells.length, sol.cells.length)
  for (let i = 0; i < size; i++) {
    if (sol.cells[i] === FILLED && s.cells[i] !== FILLED) {
      return { index: i, from: s.cells[i]!, to: FILLED }
    }
  }
  for (let i = 0; i < size; i++) {
    if (sol.cells[i] !== FILLED && s.cells[i] === FILLED) {
      return { index: i, from: FILLED, to: MARK }
    }
  }
  return null
}
