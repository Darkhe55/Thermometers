/**
 * 温度计（Thermometers）题面图片导入（自动识图 + 数字 OCR）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--size N | --width W --height H]
 *                                  [--name 名称] [--id ID] [--rows "a,b,…"] [--cols "a,b,…"]
 *                                  [--append] [--verify] [--dry] [--force]
 *
 * 识图原理：
 *   1. Playwright + Edge 打开图片到 canvas，取像素；
 *   2. 用 #cccccc 灰线找出题板外框，再用「投影命中数」拟合网格，得到 30×30 格子；
 *   3. 每支温度计的粗黑描边是一个闭合连通域：取外框包围盒，
 *      按「外框跨度 = (k-1)×格距 + 球端端帽 + 尾端端帽」反推格子数 k；
 *      端帽半径由外框剖面自动校准，端部更粗的一侧是球端；
 *   4. 所有温度计的格子必须恰好铺满题板，个别 ±1 格误差用冲突修复微调；
 *   5. 盘外粗体数字用「多字体模板匹配」OCR：左侧=行和、上方=列和；
 *   6. 生成题库格式 board = "路径;路径;…|行和|列和"，--append 写入 imported-puzzles.ts；
 *   7. --verify 用项目求解器检查唯一解（30×30 通常超时，只警告）。
 *
 * 识别不确定时用 --rows / --cols 直接覆盖线索，或 --width/--height 覆盖棋盘尺寸。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  return process.argv[i + 1] ?? fallback
}
function has(name) {
  return process.argv.includes(name)
}

const imageArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--size N | --width W --height H] [--name 名称] [--id ID] [--rows "…"] [--cols "…"] [--append] [--verify] [--dry] [--force]',
  )
  process.exit(1)
}
const imagePath = path.resolve(process.cwd(), imageArg)
if (!existsSync(imagePath)) {
  console.error(`[import] 找不到图片：${imagePath}`)
  process.exit(1)
}

const sizeOpt = Number(arg('--size', '0')) || 0
const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const rowsOverride = arg('--rows', '')
const colsOverride = arg('--cols', '')
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const id = arg('--id', `thermometer-import-${Date.now().toString(36)}`)
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')
const force = has('--force')

/* ───────────────────────── 识图（浏览器内） ───────────────────────── */

const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analyzed = await page.evaluate(async (url) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cv = document.getElementById('c')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, W, H).data
  const lum = (x, y) => {
    const i = (y * W + x) * 4
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  }

  // ── 1) 题板外框（#cccccc 粗灰线） ──
  const isGrey = (x, y) => Math.abs(lum(x, y) - 204) <= 14
  const greyCol = new Int32Array(W)
  const greyRow = new Int32Array(H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (isGrey(x, y)) {
        greyCol[x]++
        greyRow[y]++
      }
  const bands = (arr, minCount) => {
    const out = []
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < minCount) continue
      let j = i
      while (j + 1 < arr.length && arr[j + 1] >= minCount) j++
      out.push({ start: i, end: j, width: j - i + 1 })
      i = j
    }
    return out
  }
  const colBands = bands(greyCol, H * 0.85).filter((b) => b.width >= 4)
  const rowBands = bands(greyRow, W * 0.85).filter((b) => b.width >= 4)
  if (colBands.length < 2 || rowBands.length < 2) {
    return { error: '没找到题板粗灰外框，请确认图片是温度计题面' }
  }
  const xL = colBands[0].end + 1
  const xR = colBands[colBands.length - 1].start - 1
  const yT = rowBands[0].end + 1
  const yB = rowBands[rowBands.length - 1].start - 1

  // ── 2) 拟合格子数：真网格的每条内部线都应是「整行/整列的灰线」 ──
  const lineScore = (n, axis) => {
    const arr = axis === 'x' ? greyCol : greyRow
    const start = axis === 'x' ? xL : yT
    const end = axis === 'x' ? xR : yB
    const lineLen = axis === 'x' ? H : W
    const gap = (end - start) / n
    const strong = (at) => {
      let best = 0
      for (let d = -2; d <= 2; d++) best = Math.max(best, arr[at + d] ?? 0)
      return best > lineLen * 0.5 ? 1 : 0
    }
    let hits = 0
    let mids = 0
    for (let k = 1; k < n; k++) hits += strong(Math.round(start + k * gap))
    for (let k = 0; k < n; k++) mids += strong(Math.round(start + (k + 0.5) * gap))
    return hits - mids
  }
  let bestN = 0
  let bestScore = -Infinity
  const scores = []
  for (let n = 4; n <= 40; n++) {
    const s = lineScore(n, 'x') + lineScore(n, 'y')
    scores.push([n, s])
    if (s > bestScore) {
      bestScore = s
      bestN = n
    }
  }
  const nCols = bestN
  const nRows = bestN
  const cell = (xR - xL) / nCols

  // ── 3) 温度计 = 黑色描边连通域（厚描边，尺寸足够大） ──
  //    大多数胶囊描边是闭合的；个别描边被抗锯齿切断的情况，用黑块碎片并集在 node 侧补回。
  const seen = new Uint8Array(W * H)
  const capsules = []
  const blackPieces = []
  for (let y = yT; y < yB; y++)
    for (let x = xL; x < xR; x++) {
      const k = y * W + x
      if (seen[k] || lum(x, y) >= 110) continue
      let size = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      const pixels = []
      const st = [[x, y]]
      seen[k] = 1
      while (st.length) {
        const [cx, cy] = st.pop()
        size++
        pixels.push(cy * W + cx)
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < xL || ny < yT || nx >= xR || ny >= yB) continue
          const nk = ny * W + nx
          if (seen[nk] || lum(nx, ny) >= 110) continue
          seen[nk] = 1
          st.push([nx, ny])
        }
      }
      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      if (size >= 40 && bw >= 6 && bh >= 3) blackPieces.push({ size, bbox: { minX, minY, maxX, maxY } })
      // 太小的是刻度；细长条是描边被切断的碎片，跳过，交给恢复逻辑
      if (size < 400) continue
      if (bw < 12 || bh < 12) continue
      const horiz = bw >= bh
      const span = horiz ? bw : bh
      // 沿长轴粗细剖面：球头圆环比管身粗
      const profile = new Int32Array(span)
      for (const p of pixels) {
        const pxx = p % W
        const pyy = (p / W) | 0
        profile[horiz ? pxx - minX : pyy - minY]++
      }
      const mid = Math.round(span / 2)
      const midVals = []
      for (let i = mid - 5; i <= mid + 5; i++) if (i >= 0 && i < span) midVals.push(profile[i])
      midVals.sort((a, b) => a - b)
      const bodyThick = midVals[Math.floor(midVals.length / 2)] ?? 0
      let lThick = 0
      let rThick = 0
      for (let i = 0; i < Math.min(16, span); i++) lThick = Math.max(lThick, profile[i])
      for (let i = Math.max(0, span - 16); i < span; i++) rThick = Math.max(rThick, profile[i])
      capsules.push({
        size,
        horiz,
        bbox: { minX, minY, maxX, maxY },
        span,
        bodyThick,
        lThick,
        rThick,
        bulbEnd: lThick > rThick ? 'min' : lThick < rThick ? 'max' : 'max',
      })
    }

  // ── 4) 盘外线索数字 OCR（多字体模板匹配） ──
  const comps = (bx0, by0, bx1, by1) => {
    const seen2 = new Uint8Array(W * H)
    const out = []
    for (let y = Math.max(0, by0); y < Math.min(H, by1); y++)
      for (let x = Math.max(0, bx0); x < Math.min(W, bx1); x++) {
        const k = y * W + x
        if (seen2[k] || lum(x, y) >= 100) continue
        let n = 0
        let sx = 0
        let sy = 0
        let minX = x
        let maxX = x
        let minY = y
        let maxY = y
        const st = [[x, y]]
        seen2[k] = 1
        while (st.length) {
          const [cx, cy] = st.pop()
          n++
          sx += cx
          sy += cy
          if (cx < minX) minX = cx
          if (cx > maxX) maxX = cx
          if (cy < minY) minY = cy
          if (cy > maxY) maxY = cy
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < bx0 || ny < by0 || nx >= bx1 || ny >= by1) continue
            const nk = ny * W + nx
            if (seen2[nk] || lum(nx, ny) >= 100) continue
            seen2[nk] = 1
            st.push([nx, ny])
          }
        }
        out.push({ n, cx: sx / n, cy: sy / n, w: maxX - minX + 1, h: maxY - minY + 1, minX, minY, maxX, maxY })
      }
    return out
  }
  const glyphFilter = (arr) =>
    arr.filter((c) => c.n >= 15 && c.h >= cell * 0.25 && c.h <= cell * 0.95 && c.w <= cell * 1.1)
  const rowGlyphs = glyphFilter(comps(Math.round(xL - cell * 1.25), yT, Math.round(xL - 2), yB))
  const colGlyphs = glyphFilter(comps(xL, Math.round(yT - cell * 1.25), xR, Math.round(yT - 2)))
  const groupLines = (arr, key, tol) => {
    const sorted = arr.slice().sort((a, b) => a[key] - b[key])
    const lines = []
    for (const c of sorted) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(c[key] - last.avg) <= tol) {
        last.items.push(c)
        last.avg = last.items.reduce((s, m) => s + m[key], 0) / last.items.length
      } else lines.push({ avg: c[key], items: [c] })
    }
    for (const l of lines) l.items.sort((a, b) => a.cx - b.cx)
    return lines
  }
  const rowLines = groupLines(rowGlyphs, 'cy', cell * 0.42)
  const colLines = groupLines(colGlyphs, 'cx', cell * 0.42)

  const N = 20
  const glyphBitmap = (c) => {
    const bw = c.maxX - c.minX + 1
    const bh = c.maxY - c.minY + 1
    const bm = new Float32Array(N * N)
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        let sum = 0
        let cnt = 0
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const pxx = Math.round(c.minX + ((i + 0.5) * bw) / N + ox * 0.7)
            const pyy = Math.round(c.minY + ((j + 0.5) * bh) / N + oy * 0.7)
            if (pxx < 0 || pyy < 0 || pxx >= W || pyy >= H) continue
            sum += Math.max(0, Math.min(1, (255 - lum(pxx, pyy)) / 255))
            cnt++
          }
        bm[j * N + i] = cnt ? sum / cnt : 0
      }
    return bm
  }
  const fonts = [
    'Arial',
    'Arial Black',
    'Helvetica',
    'Verdana',
    'Tahoma',
    'Trebuchet MS',
    'Segoe UI',
    'Calibri',
    'Franklin Gothic Medium',
    'Liberation Sans',
    'DejaVu Sans',
    'Noto Sans',
  ]
  const tcv = document.createElement('canvas')
  tcv.width = 520
  tcv.height = 120
  const tg = tcv.getContext('2d', { willReadFrequently: true })
  const renderTemplates = (font, weight) => {
    tg.fillStyle = '#fff'
    tg.fillRect(0, 0, 520, 120)
    tg.fillStyle = '#000'
    tg.font = `${weight} 70px "${font}"`
    tg.textBaseline = 'top'
    tg.fillText('0123456789', 4, 6)
    const td = tg.getImageData(0, 0, 520, 120).data
    const tl = (x, y) => {
      const i = (y * 520 + x) * 4
      return 0.299 * td[i] + 0.587 * td[i + 1] + 0.114 * td[i + 2]
    }
    const seenT = new Uint8Array(520 * 120)
    const out = []
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 520; x++) {
        const k = y * 520 + x
        if (seenT[k] || tl(x, y) > 128) continue
        let n = 0
        let minX = x
        let maxX = x
        let minY = y
        let maxY = y
        const st = [[x, y]]
        seenT[k] = 1
        while (st.length) {
          const [cx, cy] = st.pop()
          n++
          if (cx < minX) minX = cx
          if (cx > maxX) maxX = cx
          if (cy < minY) minY = cy
          if (cy > maxY) maxY = cy
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= 520 || ny >= 120) continue
            const nk = ny * 520 + nx
            if (seenT[nk] || tl(nx, ny) > 128) continue
            seenT[nk] = 1
            st.push([nx, ny])
          }
        }
        out.push({ n, minX, maxX, minY, maxY })
      }
    const glyphs = out.filter((c) => c.n > 30).sort((a, b) => a.minX - b.minX).slice(0, 10)
    if (glyphs.length !== 10) return null
    return glyphs.map((c) => {
      const bw = c.maxX - c.minX + 1
      const bh = c.maxY - c.minY + 1
      const bm = new Float32Array(N * N)
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          let sum = 0
          let cnt = 0
          for (let oy = -1; oy <= 1; oy++)
            for (let ox = -1; ox <= 1; ox++) {
              const pxx = Math.round(c.minX + ((i + 0.5) * bw) / N + ox * 0.7)
              const pyy = Math.round(c.minY + ((j + 0.5) * bh) / N + oy * 0.7)
              if (pxx < 0 || pyy < 0 || pxx >= 520 || pyy >= 120) continue
              sum += Math.max(0, Math.min(1, (255 - tl(pxx, pyy)) / 255))
              cnt++
            }
          bm[j * N + i] = cnt ? sum / cnt : 0
        }
      return bm
    })
  }
  const bitmapDiff = (a, b) => {
    let s = 0
    for (let i = 0; i < N * N; i++) s += Math.abs(a[i] - b[i])
    return s / (N * N)
  }
  const allBitmaps = [...rowGlyphs, ...colGlyphs].map(glyphBitmap)
  let bestFont = null
  for (const font of fonts)
    for (const weight of ['bold', 'normal']) {
      const templates = renderTemplates(font, weight)
      if (!templates) continue
      let total = 0
      for (const bm of allBitmaps) {
        let m = Infinity
        for (const t of templates) m = Math.min(m, bitmapDiff(bm, t))
        total += m
      }
      const avg = total / Math.max(1, allBitmaps.length)
      if (!bestFont || avg < bestFont.avg) bestFont = { name: `${font} ${weight}`, templates, avg }
    }
  if (!bestFont) return { error: '数字 OCR 模板渲染失败' }
  const digitOf = (bm) => {
    let best = -1
    let bestDiff = Infinity
    bestFont.templates.forEach((t, i) => {
      const diff = bitmapDiff(bm, t)
      if (diff < bestDiff) {
        bestDiff = diff
        best = i
      }
    })
    return { digit: best, diff: bestDiff }
  }
  const readLines = (lines) =>
    lines.map((line) => {
      const ds = line.items.map((c) => digitOf(glyphBitmap(c)))
      return {
        value: ds.reduce((a, r) => a * 10 + r.digit, 0),
        worst: ds.reduce((a, r) => Math.max(a, r.diff), 0),
      }
    })
  const rowClues = readLines(rowLines)
  const colClues = readLines(colLines)
  return {
    W,
    H,
    xL,
    xR,
    yT,
    yB,
    nCols,
    nRows,
    cell,
    capsules,
    blackPieces,
    rowClues,
    colClues,
    fontGuess: bestFont.name,
    fontAvg: bestFont.avg,
    scores: scores.slice().sort((a, b) => b[1] - a[1]).slice(0, 5).map((s) => [s[0], Math.round(s[1])]),
  }
}, dataUrl)
await browser.close()

if (analyzed.error) {
  console.error(`[import] ${analyzed.error}`)
  process.exit(1)
}

const { nCols, nRows, cell, capsules, rowClues, colClues } = analyzed
const w = widthOpt || sizeOpt || nCols
const h = heightOpt || sizeOpt || nRows
if (w !== nCols || h !== nRows) {
  console.error(`[import] 网格不匹配：识别到 ${nCols}×${nRows}，目标 ${w}×${h}`)
  process.exit(1)
}
console.log(
  `[import] ${path.basename(imagePath)}：${analyzed.W}×${analyzed.H}，题板 ${w}×${h}，` +
    `格距 ${cell.toFixed(2)}px，温度计描边 ${capsules.length} 个`,
)
console.log(
  `[import] OCR 字体猜测：${analyzed.fontGuess}（平均误差 ${analyzed.fontAvg.toFixed(4)}），` +
    `网格候选 ${JSON.stringify(analyzed.scores)}`,
)

/* ───────────────────────── 温度计格子推导 ───────────────────────── */

// 端帽半径不用固定常数：先用初值跑一遍，再把「外框到端格中心」的残差取中位数校准
const cap = { bulb: cell * 0.33, tail: cell * 0.22 }

function capsuleSpan(c) {
  const span = c.horiz ? c.bbox.maxX - c.bbox.minX : c.bbox.maxY - c.bbox.minY
  return Math.max(1, Math.round((span + 1 - cap.bulb - cap.tail) / cell) + 1)
}

function capsuleCells(c, offset = 0) {
  const horiz = c.horiz
  const k = capsuleSpan(c)
  const bulbAtMin = c.bulbEnd === 'min'
  const startCap = bulbAtMin ? cap.bulb : cap.tail
  const startCenter = (horiz ? c.bbox.minX : c.bbox.minY) + startCap
  const origin = horiz ? analyzed.xL : analyzed.yT
  const idx0 = Math.round((startCenter - origin) / cell - 0.5) + offset
  const cross = horiz
    ? Math.round(((c.bbox.minY + c.bbox.maxY) / 2 - analyzed.yT) / cell - 0.5)
    : Math.round(((c.bbox.minX + c.bbox.maxX) / 2 - analyzed.xL) / cell - 0.5)
  if (cross < 0 || cross >= (horiz ? nRows : nCols)) return null
  const cells = []
  for (let t = 0; t < k; t++) {
    const along = idx0 + t
    if (along < 0 || along >= (horiz ? nCols : nRows)) return null
    cells.push(horiz ? cross * nCols + along : along * nCols + cross)
  }
  return { cells: bulbAtMin ? cells : cells.slice().reverse(), k, horiz, offset, idx0, cross }
}

// 用当前 cap 估计每个胶囊的实际端帽，取中位数迭代校准
for (let iter = 0; iter < 4; iter++) {
  const bulbSamples = []
  const tailSamples = []
  for (const c of capsules) {
    const p = capsuleCells(c, 0)
    if (!p) continue
    const horiz = c.horiz
    const origin = horiz ? analyzed.xL : analyzed.yT
    const minCenter = origin + (p.idx0 + 0.5) * cell
    const maxCenter = origin + (p.idx0 + p.k - 0.5) * cell
    const edgeMin = horiz ? c.bbox.minX : c.bbox.minY
    const edgeMax = horiz ? c.bbox.maxX : c.bbox.maxY
    const capMin = minCenter - edgeMin
    const capMax = edgeMax - maxCenter
    const bulbAtMin = c.bulbEnd === 'min'
    const bulbSample = bulbAtMin ? capMin : capMax
    const tailSample = bulbAtMin ? capMax : capMin
    if (bulbSample > cell * 0.15 && bulbSample < cell * 0.55) bulbSamples.push(bulbSample)
    if (tailSample > cell * 0.05 && tailSample < cell * 0.45) tailSamples.push(tailSample)
  }
  const med = (arr) => {
    if (!arr.length) return null
    arr.sort((a, b) => a - b)
    return arr[Math.floor(arr.length / 2)]
  }
  const mb = med(bulbSamples)
  const mt = med(tailSamples)
  if (mb === null || mt === null) break
  const prev = cap.bulb + cap.tail
  cap.bulb = mb
  cap.tail = mt
  if (Math.abs(cap.bulb + cap.tail - prev) < 0.4) break
}
console.log(
  `[import] 端帽校准：球端 ${cap.bulb.toFixed(2)}px / 尾端 ${cap.tail.toFixed(2)}px（格距 ${cell.toFixed(2)}px）`,
)

/** 冲突修复：把越界/重叠/空洞的胶囊整体平移 ±1~2 格，直到覆盖恰好铺满题板 */
const total = nCols * nRows
let placed = capsules.map((c) => capsuleCells(c))
const offsets = capsules.map(() => 0)
function coverageOf(list) {
  const owner = new Int32Array(total).fill(-1)
  let dup = 0
  let missing = 0
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    if (!p) continue
    for (const cellIdx of p.cells) {
      if (owner[cellIdx] !== -1) dup++
      owner[cellIdx] = i
    }
  }
  for (let i = 0; i < total; i++) if (owner[i] === -1) missing++
  return { owner, dup, missing }
}

/* ── 空缺格子恢复：个别胶囊描边被抗锯齿切成碎片，用碎片并集补出这支温度计 ── */
function recoverMissingCells(placedList) {
  const covered = new Int32Array(total)
  for (const p of placedList) if (p) for (const c of p.cells) covered[c]++
  const missSeen = new Uint8Array(total)
  const runs = []
  for (let i = 0; i < total; i++) {
    if (covered[i] || missSeen[i]) continue
    const run = []
    const st = [i]
    missSeen[i] = 1
    while (st.length) {
      const c = st.pop()
      run.push(c)
      const x = c % nCols
      const y = (c / nCols) | 0
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= nCols || ny >= nRows) continue
        const j = ny * nCols + nx
        if (covered[j] || missSeen[j]) continue
        missSeen[j] = 1
        st.push(j)
      }
    }
    runs.push(run)
  }
  let added = 0
  for (const run of runs) {
    const xs = run.map((i) => i % nCols)
    const ys = run.map((i) => (i / nCols) | 0)
    const horiz = new Set(ys).size === 1
    const minC = Math.min(...xs)
    const maxC = Math.max(...xs)
    const minR = Math.min(...ys)
    const maxR = Math.max(...ys)
    const along0 = (horiz ? analyzed.xL + minC * cell : analyzed.yT + minR * cell)
    const along1 = (horiz ? analyzed.xL + (maxC + 1) * cell : analyzed.yT + (maxR + 1) * cell)
    const cross0 = (horiz ? analyzed.yT + minR * cell : analyzed.xL + minC * cell)
    const cross1 = (horiz ? analyzed.yT + (maxR + 1) * cell : analyzed.xL + (maxC + 1) * cell)
    const midCross = (cross0 + cross1) / 2
    // 碎片必须整体落在空缺段长轴范围 ±0.8 格内，横轴中心落在同一行/列
    const pieces = analyzed.blackPieces.filter((p) => {
      const b = p.bbox
      const bAlong0 = horiz ? b.minX : b.minY
      const bAlong1 = horiz ? b.maxX : b.maxY
      const bCrossMid = horiz ? (b.minY + b.maxY) / 2 : (b.minX + b.maxX) / 2
      return (
        Math.abs(bCrossMid - midCross) <= cell * 0.5 &&
        bAlong0 >= along0 - cell * 0.8 &&
        bAlong1 <= along1 + cell * 0.8
      )
    })
    if (!pieces.length) continue
    let a0 = Infinity
    let a1 = -Infinity
    let c0 = Infinity
    let c1 = -Infinity
    for (const p of pieces) {
      const b = p.bbox
      a0 = Math.min(a0, horiz ? b.minX : b.minY)
      a1 = Math.max(a1, horiz ? b.maxX : b.maxY)
      c0 = Math.min(c0, horiz ? b.minY : b.minX)
      c1 = Math.max(c1, horiz ? b.maxY : b.maxX)
    }
    const span = a1 - a0 + 1
    const k = Math.max(1, Math.round((span - cap.bulb - cap.tail) / cell) + 1)
    const startCenter = a0 + (cap.bulb + cap.tail) / 2
    const origin = horiz ? analyzed.xL : analyzed.yT
    const idx0 = Math.round((startCenter - origin) / cell - 0.5)
    const cross = horiz
      ? Math.round(((c0 + c1) / 2 - analyzed.yT) / cell - 0.5)
      : Math.round(((c0 + c1) / 2 - analyzed.xL) / cell - 0.5)
    if (cross < 0 || cross >= (horiz ? nRows : nCols)) continue
    const cells = []
    let ok = true
    for (let t2 = 0; t2 < k; t2++) {
      const along = idx0 + t2
      if (along < 0 || along >= (horiz ? nCols : nRows)) {
        ok = false
        break
      }
      cells.push(horiz ? cross * nCols + along : along * nCols + cross)
    }
    if (!ok) continue
    if (!run.every((c) => cells.includes(c))) continue
    if (cells.some((c) => covered[c] > 0)) continue
    // 球端判断：球头圆环比管身粗，取两端碎片的垂直方向最大高度比较
    const perpSize = (p) => (horiz ? p.bbox.maxY - p.bbox.minY + 1 : p.bbox.maxX - p.bbox.minX + 1)
    const nearMin = pieces.filter((p) => {
      const aStart = horiz ? p.bbox.minX : p.bbox.minY
      const aEnd = horiz ? p.bbox.maxX : p.bbox.maxY
      return aEnd <= a0 + cell * 1.1 && aStart >= a0 - cell * 0.2
    })
    const nearMax = pieces.filter((p) => {
      const aStart = horiz ? p.bbox.minX : p.bbox.minY
      const aEnd = horiz ? p.bbox.maxX : p.bbox.maxY
      return aStart >= a1 - cell * 1.1 && aEnd <= a1 + cell * 0.2
    })
    const thicknessOf = (list) => list.reduce((m, p) => Math.max(m, perpSize(p)), 0)
    const bulbAtMin = thicknessOf(nearMin) >= thicknessOf(nearMax)
    const path = bulbAtMin ? cells : cells.slice().reverse()
    placedList.push({ cells: path, k, horiz, offset: 0, idx0, cross, recovered: true })
    for (const c of cells) covered[c]++
    added++
  }
  return { added }
}

let cov = coverageOf(placed)
for (let iter = 0; iter < 40 && (cov.dup || cov.missing); iter++) {
  let improved = false
  for (let i = 0; i < capsules.length; i++) {
    if (!placed[i]) continue
    for (const off of [-2, -1, 1, 2]) {
      const cand = capsuleCells(capsules[i], offsets[i] + off)
      if (!cand) continue
      const list = placed.slice()
      list[i] = cand
      const next = coverageOf(list)
      if (next.dup + next.missing < cov.dup + cov.missing) {
        placed = list
        cov = next
        offsets[i] += off
        improved = true
        break
      }
    }
    if (improved && !cov.dup && !cov.missing) break
  }
  if (!improved) break
}
if (cov.dup || cov.missing) {
  const cnt = new Int16Array(total)
  for (const p of placed) if (p) for (const c2 of p.cells) cnt[c2]++
  const badCells = []
  for (let i = 0; i < total; i++) if (cnt[i] !== 1) badCells.push([i % nCols, (i / nCols) | 0, cnt[i]])
  console.log('[import][debug] 异常格：' + JSON.stringify(badCells.slice(0, 40)))
  const probePts = [[760, 142], [560, 290], [640, 760], [790, 1010], [1450, 1010]]
  for (const [pxx, pyy] of probePts) {
    const hits = []
    capsules.forEach((c, i) => {
      if (pxx >= c.bbox.minX && pxx <= c.bbox.maxX && pyy >= c.bbox.minY && pyy <= c.bbox.maxY) {
        hits.push({ i, k: capsuleSpan(c), bulb: c.bulbEnd, horiz: c.horiz, span: c.span, bbox: c.bbox })
      }
    })
    console.log('[import][debug] 点(' + pxx + ',' + pyy + ') 命中描边：' + JSON.stringify(hits))
  }
  const owners = new Set()
  for (const [bx, by, n2] of badCells) {
    const idx = by * nCols + bx
    placed.forEach((p, i) => {
      if (p && p.cells.includes(idx)) owners.add(i)
    })
  }
  for (const i of owners) {
    const p = placed[i]
    console.log(
      `[import][debug] #${i} horiz=${capsules[i].horiz} bulbEnd=${capsules[i].bulbEnd} k=${p.k} idx0=${p.idx0} cross=${p.cross} bbox=${JSON.stringify(capsules[i].bbox)} span=${capsules[i].span} off=${offsets[i]}`,
    )
  }
}
const recovered = recoverMissingCells(placed)
if (recovered.added) {
  cov = coverageOf(placed)
  console.log(`[import] 用描边碎片补回了 ${recovered.added} 支温度计（剩余重复 ${cov.dup} / 空缺 ${cov.missing}）`)
}
console.log(
  `[import] 格子铺满检查：重复 ${cov.dup} 格 / 空缺 ${cov.missing} 格` +
    (cov.dup || cov.missing ? '（个别温度计位置可能仍需人工核对）' : ' ✓'),
)

/* ───────────────────────── 线索与校验 ───────────────────────── */

const parseClueList = (text) =>
  text
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
let rowSums = rowsOverride ? parseClueList(rowsOverride) : rowClues.map((r) => r.value)
let colSums = colsOverride ? parseClueList(colsOverride) : colClues.map((r) => r.value)
if (rowsOverride) console.log('[import] 使用 --rows 覆盖行和')
if (colsOverride) console.log('[import] 使用 --cols 覆盖列和')
console.log(
  `[import] 行和${rowsOverride ? '（覆盖）' : ''}：` + (rowSums.length === h ? rowSums.join(',') : `数量 ${rowSums.length} ≠ ${h}：` + rowSums.join(',')),
)
console.log(
  `[import] 列和${colsOverride ? '（覆盖）' : ''}：` + (colSums.length === w ? colSums.join(',') : `数量 ${colSums.length} ≠ ${w}：` + colSums.join(',')),
)
const sumRows = rowSums.reduce((a, b) => a + b, 0)
const sumCols = colSums.reduce((a, b) => a + b, 0)
const occupied = placed.reduce((a, p) => a + (p ? p.cells.length : 0), 0)
if (rowSums.length === h && colSums.length === w) {
  if (sumRows !== sumCols) {
    console.warn(`[import] 警告：行和合计 ${sumRows} ≠ 列和合计 ${sumCols}，OCR 可能读错，建议核对后再 --append`)
  } else if (sumRows > occupied) {
    console.warn(`[import] 警告：填充合计 ${sumRows} > 温度计占格 ${occupied}`)
  } else {
    console.log(`[import] 校验：行/列合计一致（${sumRows}），且不超过占格数 ${occupied} ✓`)
  }
}
if (rowClues.length !== h || colClues.length !== w) {
  console.warn(
    `[import] 警告：OCR 到 ${rowClues.length} 行 / ${colClues.length} 列线索，与 ${h}×${w} 不符；可用 --rows/--cols 手动指定`,
  )
}

// 预览
const paths = placed.filter(Boolean).map((p) => p.cells)
const preview = new Array(total).fill('.')
paths.forEach((cells) => {
  for (let k = 0; k < cells.length; k++) preview[cells[k]] = k === 0 ? 'B' : 'o'
})
console.log('[import] 题面预览（B=球端 o=管身 . =空）：')
for (let y = 0; y < h; y++) console.log('  ' + preview.slice(y * w, y * w + w).join(' '))

/* ───────────────────────── 编码 / 求解 / 写入 ───────────────────────── */

const encodeBoard = (thermos, rows, cols) =>
  `${thermos.map((t) => t.join(',')).join(';')}|${rows.join(',')}|${cols.join(',')}`

if (dry) {
  console.log('[import] --dry：仅识别，不写入。')
  process.exit(0)
}

if (verify) {
  const bundleFile = path.join(ROOT, 'node_modules', '.cache', 'import-verify-thermometer.mjs')
  await esbuild({
    absWorkingDir: ROOT,
    stdin: {
      contents: `export { countSolutions } from './src/game/solver.ts'`,
      resolveDir: ROOT,
      sourcefile: 'import-verify-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundleFile,
    logLevel: 'silent',
  })
  const { countSolutions } = await import(pathToFileURL(bundleFile).href)
  const t0 = Date.now()
  const res = countSolutions(paths, rowSums, colSums, total, w, h, 2, 500_000)
  const ms = Date.now() - t0
  if (res.timedOut) {
    console.warn(`[import] 唯一性检查超时（${res.nodes} 节点 / ${ms}ms），无法确认唯一解`)
  } else if (res.count === 0) {
    console.error('[import] 无解：线索或温度计识别可能有误')
    if (!force) process.exit(1)
  } else if (res.count >= 2) {
    console.warn(`[import] 解不唯一：至少 ${res.count} 个（${res.nodes} 节点 / ${ms}ms）`)
  } else {
    console.log(`[import] 唯一解检查通过（${res.nodes} 节点 / ${ms}ms）`)
  }
}

if (!append) {
  console.log('[import] 预览模式（未写入）。board 编码：')
  console.log(JSON.stringify(encodeBoard(paths, rowSums, colSums)))
  console.log('[import] 加 --append 可写入 src/game/imported-puzzles.ts')
  process.exit(0)
}

const file = path.join(ROOT, 'src/game/imported-puzzles.ts')
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${w}, height: ${h}, difficulty: "custom", series: ${JSON.stringify(series)}, board: ${JSON.stringify(encodeBoard(paths, rowSums, colSums))} },\n`
if (!existsSync(file)) {
  writeFileSync(
    file,
    `/* 由 scripts/import-image.mjs 追加，npm run gen 不会覆盖。 */\nexport interface RawPuzzle {\n  id: string\n  name: string\n  width: number\n  height: number\n  difficulty: 'easy' | 'medium' | 'hard' | 'custom'\n  series: string\n  board: string\n  solution?: string\n}\n\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]\n`,
  )
} else {
  let text = readFileSync(file, 'utf8')
  if (text.includes('IMPORTED_PUZZLES: RawPuzzle[] = []')) {
    text = text.replace('IMPORTED_PUZZLES: RawPuzzle[] = []', `IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]`)
  } else {
    const marker = text.lastIndexOf('\n]')
    if (marker < 0) throw new Error('imported-puzzles.ts 格式异常，找不到数组结尾')
    text = text.slice(0, marker + 1) + entry + text.slice(marker + 1)
  }
  writeFileSync(file, text)
}
console.log(`[import] 已写入 ${file}`)
