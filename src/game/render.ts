/**
 * 温度计 —— SVG 渲染与命中
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import {
  asThermoPuzzle,
  asThermoState,
  EMPTY,
  FILLED,
  MARK,
  type ThermoResult,
} from './types'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const cell = 46
  const pad = 62
  return {
    cell,
    pad,
    width: puzzle.width,
    height: puzzle.height,
    svgWidth: pad * 2 + puzzle.width * cell,
    svgHeight: pad * 2 + puzzle.height * cell,
    k: 1,
  }
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asThermoPuzzle(puzzle)
  const s = asThermoState(state)
  const r = result as ThermoResult
  const w = puzzle.width
  const h = puzzle.height
  const thermometers = p.thermometers ?? []
  const rowSums = p.rowSums ?? []
  const colSums = p.colSums ?? []

  const bad = new Set<number>(r.badCells ?? [])
  const badRows = new Set<number>()
  const badCols = new Set<number>()
  for (const issue of r.sumIssues ?? []) {
    if (issue.orientation === 'row') badRows.add(issue.index)
    else badCols.add(issue.index)
  }

  const gap = Math.max(1, m.cell * 0.035)
  const inner = m.cell - gap
  const radius = m.cell * 0.16
  const parts: string[] = []

  parts.push(
    `<rect class="tm-board-bg" x="${m.pad - 10}" y="${m.pad - 10}" width="${w * m.cell + 20}" height="${h * m.cell + 20}" rx="${(m.cell * 0.2).toFixed(2)}" />`,
  )

  // 格子底色
  for (let i = 0; i < w * h; i++) {
    const x = m.pad + (i % w) * m.cell + gap / 2
    const y = m.pad + Math.floor(i / w) * m.cell + gap / 2
    const v = s.cells[i] ?? EMPTY

    let cls = 'tm-cell'
    if (v === FILLED) cls += ' filled'
    else if (v === MARK) cls += ' mark'
    else cls += ' empty'
    if (bad.has(i)) cls += ' bad'

    let content = `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${inner.toFixed(2)}" height="${inner.toFixed(2)}" rx="${radius.toFixed(2)}" />`

    if (v === MARK) {
      content += `<text class="tm-x" x="${(x + inner / 2).toFixed(2)}" y="${(y + inner / 2 + m.cell * 0.02).toFixed(2)}" style="font-size:${(m.cell * 0.34).toFixed(2)}px">×</text>`
    }

    if (bad.has(i)) {
      content += `<rect class="tm-error" x="${(x + 1.2).toFixed(2)}" y="${(y + 1.2).toFixed(2)}" width="${(inner - 2.4).toFixed(2)}" height="${(inner - 2.4).toFixed(2)}" rx="${(radius * 0.8).toFixed(2)}" />`
    }

    parts.push(`<g data-index="${i}">${content}</g>`)
  }

  // 温度计管身
  const tubes: string[] = []
  for (const path of thermometers) {
    if (path.length === 0) continue
    const points = path
      .map((cell) => {
        const x = m.pad + (cell % w) * m.cell + m.cell / 2
        const y = m.pad + Math.floor(cell / w) * m.cell + m.cell / 2
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
    tubes.push(
      `<polyline class="tm-tube" points="${points}" stroke-width="${(m.cell * 0.34).toFixed(2)}" />`,
    )
    const b = path[0]!
    const bx = m.pad + (b % w) * m.cell + m.cell / 2
    const by = m.pad + Math.floor(b / w) * m.cell + m.cell / 2
    const filled = s.cells[b] === FILLED
    tubes.push(
      `<circle class="tm-bulb${filled ? ' filled' : ''}" cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${(m.cell * 0.27).toFixed(2)}" />`,
    )
  }
  parts.push(`<g class="tm-tubes">${tubes.join('')}</g>`)

  // 盘外数字
  const labels: string[] = []
  for (let y = 0; y < h; y++) {
    labels.push(
      `<text class="tm-sum${badRows.has(y) ? ' issue' : ''}" x="${(m.pad - 10).toFixed(2)}" y="${(m.pad + y * m.cell + m.cell / 2).toFixed(2)}" style="font-size:${(m.cell * 0.32).toFixed(2)}px">${rowSums[y] ?? 0}</text>`,
    )
  }
  for (let x = 0; x < w; x++) {
    labels.push(
      `<text class="tm-sum${badCols.has(x) ? ' issue' : ''}" x="${(m.pad + x * m.cell + m.cell / 2).toFixed(2)}" y="${(m.pad - 12).toFixed(2)}" style="font-size:${(m.cell * 0.32).toFixed(2)}px">${colSums[x] ?? 0}</text>`,
    )
  }
  parts.push(`<g class="tm-sums">${labels.join('')}</g>`)

  // 命中层
  for (let i = 0; i < w * h; i++) {
    parts.push(
      `<rect class="cell-hit" data-index="${i}" x="${(m.pad + (i % w) * m.cell).toFixed(2)}" y="${(m.pad + Math.floor(i / w) * m.cell).toFixed(2)}" width="${m.cell.toFixed(2)}" height="${m.cell.toFixed(2)}" />`,
    )
  }

  return `<svg class="board-svg tm-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

export function hitTest(
  m: BoardMetrics,
  puzzle: Puzzle,
  x: number,
  y: number,
): { index: number } | null {
  const col = Math.floor((x - m.pad) / m.cell)
  const row = Math.floor((y - m.pad) / m.cell)
  if (col < 0 || row < 0 || col >= puzzle.width || row >= puzzle.height) return null
  return { index: row * puzzle.width + col }
}
