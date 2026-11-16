# 温度计 Thermometers

一个基于 Web 的温度计（Thermometers）谜题游戏，原生 SVG 渲染，内置逻辑解题器。

## 在线体验

```bash
npm install
npm start
```

`npm start` 会等开发服务就绪后用默认浏览器打开 **http://127.0.0.1:5187/**。

> 也可以用 `npm run dev`，但不会自动打开浏览器。

## 游戏规则

- 每支温度计从球端（第一格）开始连续注水，一旦断开就不能再注
- 盘外数字表示该行或该列被注水的格子总数
- 所有温度计与行列数字必须同时满足

## 操作

| 操作 | 说明 |
|------|------|
| 左键点温度计格 | 注水到该格 / 取消 |
| 右键点格 | 退水 / 清除 |
| 按住拖动 | 连续注水 |
| 滚轮 / 中键拖拽 | 缩放 / 平移画布 |
| Z / Shift+Z / Y | 撤销 / 重做 |
| C / H / S / Esc | 检查 / 提示一格 / 显示解 / 清空 |
| R / L / P / M | 随机抽题 / 逻辑解题 / 暂停回放 / 音效开关 |
| 0 / + / - | 视图复位 / 放大 / 缩小 |

## 数据存放

运行 `npm start` / `npm run dev` 时，题库、进度和上次题目保存在项目内 `data/` 目录；静态部署时自动降级到浏览器 localStorage。

## 功能

- **题库**：内置多道题，题目均校验唯一解
- **自定义题板**：在侧边栏编辑题面，载入后即可游玩，支持保存、编辑、删除与唯一解校验
- **实时校验**：冲突与违规位置即时高亮，满足的条件同步变灰
- **逻辑解题**：规则引擎逐帧回放，显示每一步理由；回放中按钮变为停止，按 `P` 暂停/继续
- **提示一格 / 显示解**：提示优先揭示所有解一致的格子，显示解直接填入可行答案
- **撤销/重做**：按手势分组，一次拖拽只需一步撤销
- **进度保存**：自动保存当前题目进度，刷新不丢失
- **音效特效**：Web Audio 合成拨弦、水滴与落子动画，无外部音频资源
- **缩放/平移**：滚轮缩放，中键或 `Shift` 拖拽平移

## 技术栈

- Vite + TypeScript
- 原生 SVG（无框架）
- Web Audio 合成音效（无外部资源）
- localStorage / 项目内 `data/` 存储进度与题库

## 项目结构

```
src/
  main.ts
  core/
    app.ts / ui.ts / view.ts      界面、交互、缩放、回放控制
    store.ts / library.ts         题库、进度、上次题目存储
    audio.ts / fx.ts              音效与落子特效
  game/
    adapter.ts                    游戏规则接入
    rules.ts                      推理规则
    logic.ts                      逻辑解题回放
    render.ts / state.ts          SVG 渲染与盘面状态
    validate.ts / solver.ts       实时校验与回溯求解
    puzzles.ts / puzzles-data.ts  题库加载与静态题库
```

## 命令

```bash
npm run dev       # 开发服务
npm start         # 开发服务 + 自动打开浏览器
npm run build     # tsc --noEmit + vite build
npm run gen       # 重新生成题库
npm run check     # 审计题库
npm run verify    # 参考解、逻辑回放与交互验证
npm run audit     # 逐题审计逻辑解题
```

## 图片导入

`npm run import-image -- <图片路径>` 可以自动识别整张温度计题图（网格、每支温度计的球端/管身、盘外行/列数字），生成题库格式并可写入导入题库。

```bash
# 只识别与预览（不写入）
npm run import-image -- 题图.png --dry

# 识别并追加到题库（写入 src/game/imported-puzzles.ts，npm run gen 不会覆盖）
npm run import-image -- 题图.png --name "我的温度计" --append

# 识别 + 用项目求解器校验唯一解（30×30 大题通常超时，只警告）
npm run import-image -- 题图.png --append --verify
```

| 参数 | 说明 |
|------|------|
| `--size N` / `--width W --height H` | 覆盖棋盘尺寸；默认自动识别格子数 |
| `--rows "a,b,…"` / `--cols "a,b,…"` | OCR 不确定时手动覆盖行/列和 |
| `--name 名称` / `--id ID` | 题库里的名字 / id |
| `--append` | 写入 `src/game/imported-puzzles.ts` |
| `--verify` | 额外做唯一解检查（大题会超时警告） |
| `--dry` | 只识别、不写入 |

限制：题图里的「球端圆环」必须和管身有可见描边；若描边被抗锯齿切断成碎片，脚本会用碎片并集补出该温度计（30×30 图已验证 206 支温度计铺满 900 格、行/列和一致）。
