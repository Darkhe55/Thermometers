/**
 * 温度计（Thermometers）—— 游戏专用类型
 *
 * 规则：
 *   1. 每支温度计从球端（第一格）开始连续注水，一旦断开就不能再注；
 *   2. 盘外数字表示该行/列被注水的格子总数。
 *
 * 状态：0 = 未定，1 = 注水，2 = 空。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'

export const EMPTY = 0
export const FILLED = 1
export const MARK = 2

export type CellValue = 0 | 1 | 2

export interface ThermoPuzzle extends Puzzle {
  /** 每支温度计：从球端到末端的格索引数组 */
  thermometers: number[][]
  rowSums: number[]
  colSums: number[]
  /** 参考解：1 注水 / 2 空 */
  solution?: number[]
}

export interface ThermoState extends GameState {
  cells: number[]
  givens: number[]
}

export interface LineIssue {
  orientation: 'row' | 'col'
  index: number
  filled: number
  target: number
}

export interface ThermoResult extends ValidationResult {
  empty: number
  complete: boolean
  filled: number
  prefixIssues: number[]
  sumIssues: LineIssue[]
  badCells: number[]
}

export function asThermoPuzzle(p: Puzzle): ThermoPuzzle {
  return p as ThermoPuzzle
}

export function asThermoState(s: GameState): ThermoState {
  return s as ThermoState
}

/* ────────────────────────── 编码 ────────────────────────── */

export function encodeBoard(
  thermometers: number[][],
  rowSums: number[],
  colSums: number[],
): string {
  const thermos = thermometers.map((path) => path.join(',')).join(';')
  return `${thermos}|${rowSums.join(',')}|${colSums.join(',')}`
}

export function decodeBoard(
  text: string,
  expected: number,
  w: number,
  h: number,
): { thermometers: number[][]; rowSums: number[]; colSums: number[] } | null {
  if (typeof text !== 'string') return null
  const parts = text.split('|')
  if (parts.length !== 3) return null

  const thermometers: number[][] = []
  if (parts[0] !== '') {
    for (const t of parts[0]!.split(';')) {
      if (t === '') return null
      const path: number[] = []
      for (const part of t.split(',')) {
        const n = Number(part)
        if (!Number.isInteger(n) || n < 0 || n >= expected) return null
        path.push(n)
      }
      if (path.length < 1) return null
      thermometers.push(path)
    }
  }

  const parseNums = (s: string, len: number): number[] | null => {
    const out: number[] = []
    for (const part of s.split(',')) {
      const n = Number(part)
      if (!Number.isInteger(n) || n < 0) return null
      out.push(n)
    }
    return out.length === len ? out : null
  }

  const rowSums = parseNums(parts[1]!, h)
  const colSums = parseNums(parts[2]!, w)
  if (!rowSums || !colSums) return null
  return { thermometers, rowSums, colSums }
}

export function encodeCells(cells: ArrayLike<number>): string {
  let out = ''
  for (let i = 0; i < cells.length; i++) out += String(cells[i]! | 0)
  return out
}

export function decodeCells(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0' || ch === '.') out[i] = EMPTY
    else if (ch === '1' || ch === 'F' || ch === 'f' || ch === '#') out[i] = FILLED
    else if (ch === '2' || ch === 'X' || ch === 'x' || ch === '-') out[i] = MARK
    else return null
  }
  return out
}
