/**
 * 挂点布置与受力核定（唯一计算源）
 * ------------------------------------------------------------------
 * 三处取数同源：参数与灯体预览页、备料统计与材料页、导出清单都只调用
 * computeHanging(l) 这一个函数，显示/导出一律用本文件的 fX/fT/fM 格式化，
 * 保证同一挂点拉力、同一段弯矩在三处没有出入。
 *
 * 灯重不另估：蒙面克重 = 备料单 coveringM2（含缝份，来自蒙面裁片）× 材料清单
 * 面密度；骨架克重 = 备料单 frameM（含绑扎余量）× 竹篾线密度；扎线/胶/LED/
 * 小件同样取自 SingleLightMaterials。禁止一处按面积、一处按张数。
 *
 * 算法：
 *  - 重量先按克(g)算，力按牛(N = g/1000 × g)算，千克仅作换算展示；
 *  - 杆自重按相邻节点平分（Voronoi 归属）落到挂点/支座，节点间弯矩线性，
 *    因此各段弯矩极值必落在挂点或支座处（逐段累加）；
 *  - 另用真实均布杆重做一次整杆核算（含挑出端，支座反力与挑出端分开），
 *    与节点法对账（反力、跨端闭合弯矩、极值偏差）。
 * 单位/精度：长度 mm（挂点/孔位取整），拉力 N 保留 1 位小数，弯矩 N·m 保留
 * 2 位小数，应力 MPa 保留 1 位小数，挠度 mm 保留 1 位小数。
 */
import type {
  CheckResult,
  HangingCommit,
  HangingLight,
  HangingSetup,
  HangingStrategyId,
  Lantern
} from './types'
import { computeBatch, computeMaterials, type SingleLightMaterials } from './materials'
import {
  HANGING_CATALOG,
  coveringSpec,
  gradeSpec,
  pickRing,
  pickRope,
  rodSpec,
  type RingSpec,
  type RodSpec,
  type RopeSpec,
  type SafetyGradeSpec
} from './craft'
import { forceTableCsv, materialsCsv } from './exporter'

const CAT = HANGING_CATALOG
const GRAVITY = CAT.gravity

// ---------- 统一格式化（三处显示与导出都用这一份，不许各自 toFixed） ----------
/** 挂点/孔位长度：mm 取整 */
export const fX = (v: number): string => String(Math.round(v))
/** 拉力：N 保留 1 位小数 */
export const fT = (v: number): string => (Math.round(v * 10) / 10).toFixed(1)
/** 弯矩：N·m 保留 2 位小数（入参 N·mm） */
export const fM = (nmm: number): string => (Math.round((nmm / 1000) * 100) / 100).toFixed(2)
/** 克重保留 1 位小数 */
export const fG = (v: number): string => (Math.round(v * 10) / 10).toFixed(1)
/** 应力 MPa 1 位 */
export const fS = (v: number): string => (Math.round(v * 10) / 10).toFixed(1)
const nToKg = (n: number): number => n / GRAVITY

// ===================== 灯重（只取自备料单与材料清单） =====================

export interface WeightBreakdown {
  /** 蒙面克重 = coveringM2 × 面密度（含缝份面积，同备料单） */
  coveringG: number
  /** 骨架克重 = frameM × 竹篾线密度（含绑扎余量长度，同备料单） */
  frameG: number
  glueG: number
  lashG: number
  ledG: number
  fittingsG: number
  totalG: number
  totalN: number
  totalKg: number
  /** 取数依据（全部为备料单上的数，材料页/导出对账用） */
  basis: {
    coveringId: Lantern['covering']
    coveringM2: number
    coveringGM2: number
    frameM: number
    frameGPerM: number
    glueG: number
    lashM: number
    lashGPerM: number
    ledCount: number
    ledEachG: number
    fittingsEachG: number
  }
}

/**
 * 单灯重量。所有原料用量直接取 computeMaterials() 的备料结果：
 * coveringM2/frameM/lashM/glueG/ledCount，材料单位重量取同一份材料清单。
 */
export function lanternWeight(l: Lantern, mats: SingleLightMaterials = computeMaterials(l)): WeightBreakdown {
  const cov = coveringSpec(l.covering)
  const coveringG = mats.coveringM2 * cov.weightGM2
  const frameG = mats.frameM * CAT.frameBamboo.weightGPerM
  const glueG = mats.glueG
  const lashG = mats.lashM * CAT.extras.lashGPerM
  const ledG = mats.ledCount * CAT.extras.ledEachG
  const fittingsG = CAT.extras.fittingsEachG
  const totalG = coveringG + frameG + glueG + lashG + ledG + fittingsG
  return {
    coveringG,
    frameG,
    glueG,
    lashG,
    ledG,
    fittingsG,
    totalG,
    totalN: (totalG / 1000) * GRAVITY,
    totalKg: totalG / 1000,
    basis: {
      coveringId: l.covering,
      coveringM2: mats.coveringM2,
      coveringGM2: cov.weightGM2,
      frameM: mats.frameM,
      frameGPerM: CAT.frameBamboo.weightGPerM,
      glueG,
      lashM: mats.lashM,
      lashGPerM: CAT.extras.lashGPerM,
      ledCount: mats.ledCount,
      ledEachG: CAT.extras.ledEachG,
      fittingsEachG: CAT.extras.fittingsEachG
    }
  }
}

// ===================== 默认布置 / 规范化 =====================

export function defaultHangingSetup(_l?: Lantern): HangingSetup {
  return {
    rodLengthMm: 3000,
    leftSupportMm: 200,
    rightSupportMm: 200,
    rodId: CAT.rods[0].id,
    grade: 'normal',
    strategy: 'equal',
    lightCount: 8,
    equalPointCount: 4,
    groups: [],
    dropMm: 350,
    commit: null
  }
}

/** 等分法：净跨内按挂点 n 等分（n+1 个等距空档），灯数按轮发分到点 */
export function equalLayout(setup: HangingSetup): { xMm: number; qty: number }[] {
  const n = Math.max(2, Math.min(12, Math.round(setup.equalPointCount)))
  const xA = setup.leftSupportMm
  const xB = setup.rodLengthMm - setup.rightSupportMm
  const span = Math.max(1, xB - xA)
  const q = Math.max(n, Math.round(setup.lightCount))
  const out: { xMm: number; qty: number }[] = []
  for (let i = 1; i <= n; i++) out.push({ xMm: Math.round(xA + (span * i) / (n + 1)), qty: 0 })
  for (let k = 0; k < q; k++) out[k % n].qty += 1
  return out
}

/**
 * 返回当前生效布置（不写回 store）。等分法每次重算点位/灯数；
 * 按吊重法沿用逐点分组（现场逐点交代），只做夹紧与排序。
 */
export function effectiveSetup(l: Lantern): HangingSetup {
  const base: HangingSetup = { ...defaultHangingSetup(l), ...(l.hanging || {}) }
  base.rodLengthMm = Math.max(400, Math.round(base.rodLengthMm))
  base.leftSupportMm = Math.min(base.rodLengthMm - 200, Math.max(0, Math.round(base.leftSupportMm)))
  base.rightSupportMm = Math.min(base.rodLengthMm - base.leftSupportMm - 200, Math.max(0, Math.round(base.rightSupportMm)))
  base.lightCount = Math.max(1, Math.round(base.lightCount))
  base.equalPointCount = Math.max(2, Math.min(12, Math.round(base.equalPointCount)))
  base.dropMm = Math.max(50, Math.round(base.dropMm))

  if (base.strategy === 'equal') {
    base.groups = equalLayout(base).map((p, i) => ({ id: `D${String(i + 1).padStart(2, '0')}`, xMm: p.xMm, qty: p.qty }))
  } else {
    let groups: HangingLight[] = (base.groups || [])
      .filter((g) => g.qty > 0)
      .map((g, i) => ({ id: g.id || `D${String(i + 1).padStart(2, '0')}`, xMm: Math.round(g.xMm || 0), qty: Math.max(1, Math.round(g.qty)) }))
    if (groups.length < 2) {
      groups = equalLayout(base).map((p, i) => ({ id: `D${String(i + 1).padStart(2, '0')}`, xMm: p.xMm, qty: p.qty }))
    }
    groups = groups.map((g) => ({ ...g, xMm: Math.min(base.rodLengthMm - 40, Math.max(40, g.xMm)) })).sort((a, b) => a.xMm - b.xMm)
    for (let i = 1; i < groups.length; i++) {
      if (groups[i].xMm - groups[i - 1].xMm < 30) groups[i].xMm = groups[i - 1].xMm + 30
    }
    let overflow = groups[groups.length - 1].xMm > base.rodLengthMm - 40
    if (overflow) {
      groups[groups.length - 1].xMm = base.rodLengthMm - 40
      for (let i = groups.length - 2; i >= 0; i--) groups[i].xMm = Math.min(groups[i].xMm, groups[i + 1].xMm - 30)
    }
    base.groups = groups
    base.lightCount = groups.reduce((s, g) => s + g.qty, 0)
  }
  return base
}

// ===================== 截面特性 =====================

export interface SectionProps {
  areaMm2: number
  /** 抗弯截面模量 mm³ */
  zMm3: number
  /** 惯性矩 mm⁴ */
  iMm4: number
  /** 线密度 g/m（由材料清单密度与截面算出） */
  linearGPerM: number
}

export function sectionProps(rod: RodSpec): SectionProps {
  let area = 0
  let z = 0
  let i = 0
  if (rod.sectionShape === 'annulus') {
    const D = rod.outerDiamMm
    const d = rod.innerDiamMm
    area = (Math.PI / 4) * (D * D - d * d)
    i = (Math.PI / 64) * (D ** 4 - d ** 4)
    z = i / (D / 2)
  } else {
    const b = rod.bMm || 40
    const h = rod.hMm || 60
    area = b * h
    i = (b * h ** 3) / 12
    z = (b * h * h) / 6
  }
  return { areaMm2: area, zMm3: z, iMm4: i, linearGPerM: area * rod.densityKgM3 * 1e-3 }
}

// ===================== 梁分析（节点法 + 整杆对账） =====================

interface NodeLoad {
  x: number
  p: number
  kind: 'point' | 'support' | 'brace'
  ref: string
}

export interface RawAnalysis {
  L: number
  xA: number
  xB: number
  span: number
  nodes: NodeLoad[]
  /** 集中外载点（灯+吊环+加固件，不含支座、不含均布杆自重） */
  pointNodes: NodeLoad[]
  /** 官方支座反力（连续均布整杆解，含挑出端） */
  ra: number
  rb: number
  /** 节点集中法（杆自重按节点平分）反力，对账用 */
  raLumped: number
  rbLumped: number
  raExact: number
  rbExact: number
  w: number
  totalLampN: number
  totalLoadN: number
  /** 官方弯矩函数（集中灯载 + 连续均布杆自重，极值在挂点/支座） */
  mNode: (x: number) => number
  /** 节点集中法弯矩（对账参照） */
  mLumped: (x: number) => number
  mExact: (x: number) => number
  shearNode: (x: number) => number
  deflectionMm: (x: number) => number
  maxExactAbsMm: number
}

/**
 * 支座反力（节点法）：
 *  支座节点按 Voronoi 分到的杆自重直接由支座承担——对 A 取矩时它的力臂为 0
 * （右支座那份力臂为跨长，会进入力矩），故力矩方程只取非支座节点；
 * 合力方程包含全部节点（含两份支座自重），保证 Σ反力 = Σ荷载 且杆端闭合。
 */
function nodalReactions(trib: NodeLoad[], xA: number, xB: number): { ra: number; rb: number; total: number } {
  let mom = 0
  let force = 0
  for (const n of trib) {
    force += n.p
    if (n.kind !== 'support') mom += n.p * (n.x - xA)
    else if (n.ref === 'B') mom += n.p * (xB - xA)
  }
  const rb = mom / (xB - xA)
  const ra = force - rb
  return { ra, rb, total: force }
}

function reactionsFor(loads: NodeLoad[], xA: number, xB: number, w: number, L: number) {
  let mom = 0
  let force = 0
  for (const n of loads) {
    mom += n.p * (n.x - xA) // 挑出端荷载自然为负
    force += n.p
  }
  mom += w * L * (L / 2 - xA) // 均布杆自重合力 wL 作用于 L/2，对 A 取矩
  force += w * L
  const rb = mom / (xB - xA)
  const ra = force - rb
  return { ra, rb, total: force }
}

/** 杆长按最近节点平分（Voronoi），两端半段归最外节点 */
function tributaryLoads(nodes: NodeLoad[], w: number, L: number): NodeLoad[] {
  const out = nodes.map((n) => ({ ...n }))
  const xs = out.map((n) => n.x)
  for (const o of out) {
    const idx = xs.indexOf(o.x)
    const left = idx > 0 ? (xs[idx - 1] + o.x) / 2 : 0
    const right = idx < out.length - 1 ? (o.x + xs[idx + 1]) / 2 : L
    o.p += w * Math.max(0, right - left)
  }
  return out
}

function makeM(ra: number, rb: number, xA: number, xB: number, nodes: NodeLoad[], w: number | null) {
  const pos = (a: number, x: number) => (x > a ? x - a : 0)
  return (x: number): number => {
    // 左隔离体（正弯矩＝下部受拉）：左支座 R_A 在 x>A 时为正；右支座 R_B 在 x>B
    // 时也进入隔离体、方向向上，同样为正（+rb·(x−xB)）。
    let m = ra * pos(xA, x) + rb * pos(xB, x)
    for (const n of nodes) {
      if (n.kind === 'support') continue // 支座基座节点（p=0 或自重已并入反力）不重复计
      m -= n.p * pos(n.x, x)
    }
    if (w !== null) m -= (w * x * x) / 2
    return m
  }
}

function analyzeBeam(
  rod: RodSpec,
  setup: HangingSetup,
  pointLoads: { x: number; p: number; ref: string; kind: NodeLoad['kind'] }[]
): RawAnalysis {
  const L = setup.rodLengthMm
  const xA = setup.leftSupportMm
  const xB = L - setup.rightSupportMm
  const sec = sectionProps(rod)
  const w = ((sec.linearGPerM / 1000) * GRAVITY) / 1000 // g/m → N/mm
  const lampN = pointLoads.filter((p) => p.kind === 'point').reduce((s, p) => s + p.p, 0)

  const baseNodes: NodeLoad[] = [
    ...pointLoads,
    { x: xA, p: 0, kind: 'support' as const, ref: 'A' },
    { x: xB, p: 0, kind: 'support' as const, ref: 'B' }
  ]
    .sort((a, b) => a.x - b.x)
    .filter((n, i, arr) => i === 0 || Math.abs(arr[i - 1].x - n.x) > 0.5)

  const trib = tributaryLoads(baseNodes, w, L)
  const lumped = nodalReactions(trib, xA, xB)
  const exact = reactionsFor(baseNodes, xA, xB, w, L)
  // 官方内力：支座反力用连续均布整杆解（精确）；灯载集中、杆自重均布
  // 节点集中法仅作对账参照（杆自重集中到挂点/支座）
  const mLumped = makeM(lumped.ra, lumped.rb, xA, xB, trib, null)
  const mNode = makeM(exact.ra, exact.rb, xA, xB, baseNodes, w)
  const mExact = mNode // 同一精确模型
  const shearNode = (x: number): number => {
    let v = -w * x
    if (x >= xA) v += exact.ra
    if (x >= xB) v += exact.rb
    for (const n of baseNodes) if (n.kind !== 'support' && x >= n.x) v -= n.p
    return v
  }

  // 挠度：mExact/EI 数值双积分 + 支座位移归零（步长 5mm）
  const EI = rod.emodGPa * 1000 * sec.iMm4
  const step = 5
  const xs: number[] = []
  const mms: number[] = []
  for (let x = 0; x <= L + 1e-6; x += step) {
    xs.push(x)
    mms.push(mExact(x) / EI)
  }
  let theta = 0
  let vv = 0
  const vRaw: number[] = []
  for (let i = 0; i < xs.length; i++) {
    vRaw.push(vv)
    theta += mms[i] * step
    vv += theta * step
  }
  const iA = Math.round(xA / step)
  const iB = Math.round(xB / step)
  const vA = vRaw[iA]
  const vB = vRaw[iB]
  const rot = (vB - vA) / (iB - iA)
  const vNorm = vRaw.map((v, i) => v - vA - rot * (i - iA))
  const deflectionMm = (x: number): number => vNorm[Math.min(Math.round(x / step), vNorm.length - 1)]
  let maxExactAbsMm = 0
  for (const val of vNorm) maxExactAbsMm = Math.max(maxExactAbsMm, Math.abs(val))

  return {
    L,
    xA,
    xB,
    span: xB - xA,
    nodes: trib,
    pointNodes: pointLoads,
    ra: exact.ra,
    rb: exact.rb,
    raLumped: lumped.ra,
    rbLumped: lumped.rb,
    raExact: exact.ra,
    rbExact: exact.rb,
    w,
    totalLampN: lampN,
    totalLoadN: exact.total,
    mNode,
    mLumped,
    mExact,
    shearNode,
    deflectionMm,
    maxExactAbsMm
  }
}

// ===================== 按吊重分摊：位置优化（显式动作） =====================

/**
 * 逐点位置优化（坐标下降，确定性）：
 * 在杆全长（含挑出端，留 40mm 边距）内移动各点，使节点法最大 |弯矩| 最小，
 * 支座上拔（反力为负）重罚。每点的吊法与绳索由结果逐点交代。
 * 仅在「切到按吊重法 / 点自动均布」时调用一次，写回分组；用户手动挪灯后不覆盖。
 */
export function placeByLoad(l: Lantern, input?: HangingSetup): HangingSetup {
  const base = input || effectiveSetup(l)
  const setup: HangingSetup = { ...effectiveSetup({ ...l, hanging: { ...base, strategy: 'load' } }), strategy: 'load' }
  const rod = rodSpec(setup.rodId)
  const w = lanternWeight(l)
  const L = setup.rodLengthMm
  const xA = setup.leftSupportMm
  const xB = L - setup.rightSupportMm
  const groups = setup.groups
  const qty = groups.map((g) => g.qty)
  const pos = qty.map((_, i) => Math.round(xA + ((i + 1) * (xB - xA)) / (qty.length + 1)))

  const objective = (p: number[]): number => {
    const loads = p.map((x, i) => ({ x, p: qty[i] * w.totalN, ref: 'G' + i, kind: 'point' as const }))
    const a = analyzeBeam(rod, setup, loads)
    const ev = [0, ...[...p].sort((c, d) => c - d), a.xA, a.xB, L]
    let maxM = 0
    for (const x of ev) maxM = Math.max(maxM, Math.abs(a.mNode(x)))
    const uplift = Math.max(0, -a.ra) + Math.max(0, -a.rb)
    return maxM + uplift * 1000
  }

  const order = qty.map((q, i) => ({ q, i })).sort((a, b) => b.q - a.q).map((o) => o.i)
  let best = objective(pos)
  for (let round = 0; round < 3; round++) {
    for (const i of order) {
      let bestX = pos[i]
      for (let cand = 40; cand <= L - 40; cand += 25) {
        const trial = [...pos]
        trial[i] = cand
        trial.sort((a, b) => a - b)
        if (trial.some((x, k) => k > 0 && x - trial[k - 1] < 30)) continue
        const val = objective(trial)
        if (val < best - 1e-6) {
          best = val
          bestX = cand
        }
      }
      pos[i] = bestX
      pos.sort((a, b) => a - b)
    }
  }
  for (const i of order) {
    let bestX = pos[i]
    for (let cand = Math.max(40, pos[i] - 25); cand <= Math.min(L - 40, pos[i] + 25); cand += 5) {
      const trial = [...pos]
      trial[i] = cand
      trial.sort((a, b) => a - b)
      if (trial.some((x, k) => k > 0 && x - trial[k - 1] < 30)) continue
      const val = objective(trial)
      if (val < best - 1e-6) {
        best = val
        bestX = cand
      }
    }
    pos[i] = bestX
    pos.sort((a, b) => a - b)
  }

  // 按优化后位置排序，回带原分组身份
  const moved = groups
    .map((g) => ({ g }))
    .map(({ g }, i) => ({ id: g.id, qty: qty[i], xMm: pos[i] }))
    .sort((a, b) => a.xMm - b.xMm)
  return effectiveSetup({ ...l, hanging: { ...setup, groups: moved } })
}

// ===================== 结果类型 =====================

export interface PointResult {
  index: number
  id: string
  xMm: number
  qty: number
  lampsN: number
  tensionN: number
  tensionKg: number
  doubleSling: number
  legs: number
  perLegN: number
  rope: RopeSpec
  ropeLengthM: number
  ring: RingSpec
  note: string
}

export interface SegmentResult {
  index: number
  fromMm: number
  toMm: number
  kind: 'left-overhang' | 'span' | 'right-overhang'
  maxNodeMNmm: number
  maxAtMm: number
  maxAtEvent: boolean
  maxExactMNmm: number
  maxShearN: number
  stressMPa: number
  deflectionMm: number
  braced: boolean
}

export interface SupportResult {
  id: 'A' | 'B'
  xMm: number
  reactionN: number
  reactionKg: number
  exactN: number
  uplift: boolean
  ring: RingSpec
}

export interface RopeLine {
  spec: RopeSpec
  lengthM: number
  weightG: number
}

export interface RingLine {
  spec: RingSpec
  qty: number
}

export interface HardwareResult {
  ropeLines: RopeLine[]
  ropeTotalM: number
  ropeTotalG: number
  ringLines: RingLine[]
  ringTotalQty: number
  ringTotalG: number
  braceQty: number
  bracePositionsMm: number[]
  braceTotalG: number
  holes: { xMm: number; kind: 'point' | 'support'; ref: string }[]
  holeCount: number
  laborMin: number
}

export interface GradeVerdict {
  spec: SafetyGradeSpec
  allowStressMPa: number
  limitStressMPa: number
  allowDeflectionMm: number
  maxStressRatio: number
  maxStressSegIndex: number
  maxDeflectionMm: number
  maxDeflectionSegIndex: number
  pass: boolean
  failingSegments: number[]
  upliftSupports: string[]
}

export interface FixOption {
  id: 'add-point' | 'move-lamp'
  title: string
  action: string
  pass: boolean
  projectedMaxMNm: number
  projectedMaxStressRatio: number
  addedRopeM: number
  addedRings: number
  addedBraces: number
  addedLaborMin: number
  tradeoff: string
  nextSetup: HangingSetup
}

export interface StrategySummary {
  id: HangingStrategyId
  name: string
  pointCount: number
  maxMNm: number
  maxStressRatio: number
  maxDeflectionMm: number
  pass: boolean
  ropeTotalM: number
  ringTotalQty: number
  braceQty: number
  laborMin: number
  rodNeeded: RodSpec | null
  rodPrice: number
}

export interface TradeoffResult {
  chosen: StrategySummary
  rejected: StrategySummary
  rejectedYieldText: string
  chosenCostText: string
}

export interface HoleReuse {
  oldHolesMm: number[]
  reusedMm: number[]
  reopenMm: number[]
  addedMm: number[]
}

export interface ChangeReport {
  hasCommit: boolean
  valid: boolean
  reasons: string[]
  holes: HoleReuse
  previewChanges: string[]
  materialChanges: string[]
  exportChanges: string[]
  exportStale: boolean
}

export interface EquilibriumCheck {
  totalLoadN: number
  sumReactionN: number
  residualN: number
  reactionDevPct: number
  tipClosureNmm: number
  exactDevPct: number
  extremumAtEvent: boolean
}

export interface HangingResult {
  setup: HangingSetup
  weight: WeightBreakdown
  rod: RodSpec
  section: SectionProps
  points: PointResult[]
  supports: SupportResult[]
  segments: SegmentResult[]
  grade: GradeVerdict
  hardware: HardwareResult
  fixes: FixOption[]
  pass: boolean
  tradeoff: TradeoffResult
  digest: string
  change: ChangeReport
  equilibrium: EquilibriumCheck
  checks: CheckResult[]
}

// ===================== 摘要（作废判定 + 三处同源指纹） =====================

export function hangingDigest(l: Lantern, setup: HangingSetup, w: WeightBreakdown): string {
  void l
  const payload = {
    v: 1,
    rod: [setup.rodLengthMm, setup.leftSupportMm, setup.rightSupportMm, setup.rodId],
    grade: setup.grade,
    strategy: setup.strategy,
    drop: setup.dropMm,
    lightCount: setup.lightCount,
    equalN: setup.equalPointCount,
    groups: setup.groups.map((g) => [g.xMm, g.qty]),
    w: [
      w.basis.coveringId,
      w.basis.coveringM2,
      w.basis.coveringGM2,
      w.basis.frameM,
      w.basis.frameGPerM,
      w.basis.glueG,
      w.basis.lashM,
      w.basis.ledCount
    ]
  }
  const s = JSON.stringify(payload)
  let hash = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return 'H' + (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

// ===================== 单策略完整解算 =====================

interface StrategySolution {
  setup: HangingSetup
  analysis: RawAnalysis
  points: PointResult[]
  supports: SupportResult[]
  segments: SegmentResult[]
  grade: GradeVerdict
  hardware: HardwareResult
  equilibrium: EquilibriumCheck
  pass: boolean
  maxMNm: number
}

function solveStrategy(l: Lantern, input: HangingSetup, strategy: HangingStrategyId, w: WeightBreakdown, override?: HangingSetup): StrategySolution {
  const setup = override || effectiveSetup({ ...l, hanging: { ...input, strategy } })
  const L = setup.rodLengthMm
  const rod = rodSpec(setup.rodId)
  const sec = sectionProps(rod)
  const grade = gradeSpec(setup.grade)

  // 第一遍：不含加固件/吊环重量求内力
  const loads1 = setup.groups.map((g) => ({ x: g.xMm, p: g.qty * w.totalN, ref: g.id, kind: 'point' as const }))
  const a1 = analyzeBeam(rod, setup, loads1)

  const events = [0, ...setup.groups.map((g) => g.xMm), a1.xA, a1.xB, setup.rodLengthMm]
    .sort((p, q) => p - q)
    .filter((x, i, arr) => i === 0 || Math.abs(arr[i - 1] - x) > 0.5)

  // 加固件：应力利用 > 75% 的极值点（非支座），150mm 去重
  const limitStress = rod.bendAllowMPa * grade.stressRatio
  const bracePos: number[] = []
  for (const x of events) {
    if (Math.abs(x - a1.xA) < 1 || Math.abs(x - a1.xB) < 1 || x === 0 || x === setup.rodLengthMm) continue
    const stress = Math.abs(a1.mNode(x)) / sec.zMm3
    if (stress / limitStress > 0.75 && !bracePos.some((b) => Math.abs(b - x) < 150)) bracePos.push(Math.round(x))
  }

  // 第二遍：含吊环（挂点）与加固件重量
  const braceN = (CAT.brace.weightG / 1000) * GRAVITY
  const loads2 = [
    ...setup.groups.map((g) => {
      const ringN = (pickRing(g.qty * w.totalN).weightG / 1000) * GRAVITY
      return { x: g.xMm, p: g.qty * w.totalN + ringN, ref: g.id, kind: 'point' as const }
    }),
    ...bracePos.map((x) => ({ x, p: braceN, ref: 'BR', kind: 'brace' as const }))
  ]
  const a = analyzeBeam(rod, setup, loads2)

  // ---- 挂点：拉力、绳索、吊环（逐点交代） ----
  const points: PointResult[] = setup.groups.map((g, i) => {
    const lampsN = g.qty * w.totalN
    const doubleSling = lampsN > CAT.ropes[CAT.ropes.length - 1].ratedN
    const legs = doubleSling ? 2 : 1
    const spread = CAT.labor.slingSpreadMm
    const legLen = doubleSling ? Math.hypot(setup.dropMm, spread / 2) : setup.dropMm
    const perLegN = doubleSling ? (lampsN / 2) * (legLen / setup.dropMm) : lampsN
    const rope = pickRope(perLegN)
    const ropeLengthM = (legs * legLen + CAT.labor.cutRopeExtraM * 1000) / 1000
    const ropeN = ((rope.weightGPerM * ropeLengthM) / 1000) * GRAVITY
    const tensionN = lampsN + ropeN
    const ring = pickRing(tensionN)
    return {
      index: i + 1,
      id: g.id,
      xMm: g.xMm,
      qty: g.qty,
      lampsN,
      tensionN,
      tensionKg: nToKg(tensionN),
      doubleSling: doubleSling ? 1 : 0,
      legs,
      perLegN,
      rope,
      ropeLengthM,
      ring,
      note: doubleSling
        ? `双吊索：每股 ${fT(perLegN)}N，索长 ${(legLen / 1000).toFixed(2)}m（摊开 ${spread}mm，下垂 ${setup.dropMm}mm）`
        : `单股直吊：绳长 ${(legLen / 1000).toFixed(2)}m，下垂 ${setup.dropMm}mm`
    }
  })

  // ---- 分段：逐段累加，极值取端点（挂点/支座） ----
  const segments: SegmentResult[] = []
  const kindOf = (from: number, to: number): SegmentResult['kind'] => {
    if (to <= a.xA + 0.5) return 'left-overhang'
    if (from >= a.xB - 0.5) return 'right-overhang'
    return 'span'
  }
  const uniq = [0, ...setup.groups.map((g) => g.xMm), a.xA, a.xB, setup.rodLengthMm]
    .sort((p, q) => p - q)
    .filter((x, i, arr) => i === 0 || Math.abs(arr[i - 1] - x) > 0.5)
  const udl = a.w // 杆自重均布 N/mm（注意：外层 w 是 WeightBreakdown）
  for (let i = 0; i < uniq.length - 1; i++) {
    const from = uniq[i]
    const to = uniq[i + 1]
    // 段内无集中荷载，M 为抛物线、M'=V：极值在端点或剪力零点。
    // 集中灯载（无杆自重）时剪力段内恒定，极值严格落在挂点/支座。
    const vAt = (x: number): number => {
      let v = x >= a.xA ? a.ra : 0
      if (x >= a.xB) v += a.rb
      for (const n of a.pointNodes) if (x >= n.x) v -= n.p
      return v - udl * x
    }
    const vf = vAt(from + 1e-6)
    const vt = vAt(to - 1e-6)
    let maxAt = Math.abs(a.mNode(from)) >= Math.abs(a.mNode(to)) ? from : to
    if (vf * vt < 0 && udl > 0) {
      const xZero = from + Math.abs(vf) / udl
      if (xZero > from && xZero < to && Math.abs(a.mNode(xZero)) > Math.abs(a.mNode(maxAt))) maxAt = xZero
    }
    const maxNode = Math.abs(a.mNode(maxAt))
    let def = 0
    for (let x = Math.ceil(from / 5) * 5; x <= to; x += 5) def = Math.max(def, Math.abs(a.deflectionMm(x)))
    segments.push({
      index: segments.length + 1,
      fromMm: Math.round(from),
      toMm: Math.round(to),
      kind: kindOf(from, to),
      maxNodeMNmm: maxNode,
      maxAtMm: Math.round(maxAt),
      maxAtEvent: Math.abs(maxAt - from) < 1 || Math.abs(maxAt - to) < 1,
      maxExactMNmm: Math.abs(a.mLumped(maxAt)),
      maxShearN: Math.max(Math.abs(a.shearNode(from)), Math.abs(a.shearNode(to))),
      stressMPa: maxNode / sec.zMm3,
      deflectionMm: def,
      braced: bracePos.some((b) => b >= from && b <= to)
    })
  }

  // ---- 支座反力（与挑出端分开：上拔即点名） ----
  const supRing = pickRing(Math.max(Math.abs(a.ra), Math.abs(a.rb)))
  const supports: SupportResult[] = [
    { id: 'A', xMm: Math.round(a.xA), reactionN: a.ra, reactionKg: nToKg(a.ra), exactN: a.raExact, uplift: a.ra < 0, ring: supRing },
    { id: 'B', xMm: Math.round(a.xB), reactionN: a.rb, reactionKg: nToKg(a.rb), exactN: a.rbExact, uplift: a.rb < 0, ring: supRing }
  ]

  // ---- 安全档位判定 ----
  const allowDef = a.span / grade.deflectionRatio
  let maxRatio = 0
  let maxRatioSeg = segments[0]?.index || 0
  let maxDef = 0
  let maxDefSeg = segments[0]?.index || 0
  const failing: number[] = []
  segments.forEach((s) => {
    const r = s.stressMPa / limitStress
    if (r > maxRatio) {
      maxRatio = r
      maxRatioSeg = s.index
    }
    if (s.deflectionMm > maxDef) {
      maxDef = s.deflectionMm
      maxDefSeg = s.index
    }
    if (r > 1 || s.deflectionMm > allowDef) failing.push(s.index)
  })
  const upliftSupports = supports.filter((s) => s.uplift).map((s) => s.id)
  const gradeVerdict: GradeVerdict = {
    spec: grade,
    allowStressMPa: rod.bendAllowMPa,
    limitStressMPa: limitStress,
    allowDeflectionMm: allowDef,
    maxStressRatio: maxRatio,
    maxStressSegIndex: maxRatioSeg,
    maxDeflectionMm: maxDef,
    maxDeflectionSegIndex: maxDefSeg,
    pass: failing.length === 0 && upliftSupports.length === 0,
    failingSegments: failing,
    upliftSupports
  }

  // ---- 五金/绳索备料 ----
  const ropeMap = new Map<string, RopeLine>()
  for (const p of points) {
    const line = ropeMap.get(p.rope.id) || { spec: p.rope, lengthM: 0, weightG: 0 }
    line.lengthM += p.ropeLengthM
    line.weightG += p.rope.weightGPerM * p.ropeLengthM
    ropeMap.set(p.rope.id, line)
  }
  const ringMap = new Map<string, RingLine>()
  const addRing = (r: RingSpec, qty: number) => {
    const line = ringMap.get(r.id) || { spec: r, qty: 0 }
    line.qty += qty
    ringMap.set(r.id, line)
  }
  points.forEach((p) => addRing(p.ring, 1))
  addRing(supRing, 2)
  const ropeLines = [...ropeMap.values()].map((x) => ({ ...x, lengthM: Math.round(x.lengthM * 100) / 100, weightG: Math.round(x.weightG) }))
  const ringLines = [...ringMap.values()]
  const holes = [
    ...points.map((p) => ({ xMm: p.xMm, kind: 'point' as const, ref: p.id })),
    { xMm: Math.round(a.xA), kind: 'support' as const, ref: 'A' },
    { xMm: Math.round(a.xB), kind: 'support' as const, ref: 'B' }
  ].sort((x, y) => x.xMm - y.xMm)
  const laborMin =
    holes.length * CAT.labor.drillMin +
    points.length * CAT.labor.tiePerPointMin +
    setup.lightCount * CAT.labor.tiePerLampMin +
    ringLines.reduce((s, r) => s + r.qty, 0) * CAT.labor.ringInstallMin

  const hardware: HardwareResult = {
    ropeLines,
    ropeTotalM: Math.round(ropeLines.reduce((s, r) => s + r.lengthM, 0) * 100) / 100,
    ropeTotalG: Math.round(ropeLines.reduce((s, r) => s + r.weightG, 0)),
    ringLines,
    ringTotalQty: ringLines.reduce((s, r) => s + r.qty, 0),
    ringTotalG: Math.round(ringLines.reduce((s, r) => s + r.spec.weightG * r.qty, 0)),
    braceQty: bracePos.length,
    bracePositionsMm: bracePos,
    braceTotalG: bracePos.length * CAT.brace.weightG,
    holes,
    holeCount: holes.length,
    laborMin: Math.round(laborMin)
  }

  // ---- 整杆对账（官方=集中灯载+连续均布；细采样验证逐段极值无遗漏） ----
  const sumR = a.ra + a.rb
  const tip = a.mNode(L)
  let scanInteriorMax = 0
  for (let x = 0; x <= L; x += 5) scanInteriorMax = Math.max(scanInteriorMax, Math.abs(a.mNode(x)))
  // 逐段（端点 + 剪力零点）求得的最大弯矩应 ≥ 全杆 5mm 细采样峰值（容差 0.5%）
  const segMax = Math.max(...segments.map((s) => s.maxNodeMNmm))
  const scanDevPct = (Math.abs(scanInteriorMax - segMax) / Math.max(1, segMax)) * 100
  const equilibrium: EquilibriumCheck = {
    totalLoadN: a.totalLoadN,
    sumReactionN: sumR,
    residualN: sumR - a.totalLoadN,
    reactionDevPct:
      (Math.abs(a.ra - a.raLumped) + Math.abs(a.rb - a.rbLumped)) / Math.max(1, Math.abs(a.raLumped) + Math.abs(a.rbLumped)) * 100,
    tipClosureNmm: tip,
    exactDevPct: scanDevPct,
    extremumAtEvent: scanInteriorMax <= segMax * 1.005
  }

  return {
    setup,
    analysis: a,
    points,
    supports,
    segments,
    grade: gradeVerdict,
    hardware,
    equilibrium,
    pass: gradeVerdict.pass,
    maxMNm: segMax / 1000
  }
}

function cheapestPassingRod(
  l: Lantern,
  setup: HangingSetup,
  w: WeightBreakdown,
  override?: HangingSetup
): { rod: RodSpec | null; price: number } {
  for (const rod of [...CAT.rods].sort((a, b) => a.pricePerM - b.pricePerM)) {
    const sol = solveStrategy(l, { ...setup, rodId: rod.id }, setup.strategy, w, override ? { ...override, rodId: rod.id } : undefined)
    if (sol.pass) return { rod, price: (rod.pricePerM * setup.rodLengthMm) / 1000 }
  }
  const dearest = CAT.rods[CAT.rods.length - 1]
  return { rod: null, price: (dearest.pricePerM * setup.rodLengthMm) / 1000 }
}

function toSummary(id: HangingStrategyId, sol: StrategySolution, rodNeeded: RodSpec | null, rodPrice: number): StrategySummary {
  return {
    id,
    name: id === 'equal' ? '按挂点等分' : '按实际吊重分摊',
    pointCount: sol.points.length,
    maxMNm: sol.maxMNm,
    maxStressRatio: sol.grade.maxStressRatio,
    maxDeflectionMm: sol.grade.maxDeflectionMm,
    pass: sol.pass,
    ropeTotalM: sol.hardware.ropeTotalM,
    ringTotalQty: sol.hardware.ringTotalQty,
    braceQty: sol.hardware.braceQty,
    laborMin: sol.hardware.laborMin,
    rodNeeded,
    rodPrice
  }
}

// ===================== 两条改法（超档时点名 + 代价） =====================

/** 试加挂点：从当前数一直加到过档或 12 点上限，返回最少点数的可行方案 */
function simulateAddPoint(l: Lantern, setup: HangingSetup, w: WeightBreakdown) {
  let cur = setup
  let sol = solveStrategy(l, cur, cur.strategy, w)
  const startN = cur.strategy === 'equal' ? cur.equalPointCount : cur.groups.length
  let added = 0
  while (!sol.pass && added < 12 - startN) {
    const next: HangingSetup = JSON.parse(JSON.stringify(cur))
    added += 1
    if (next.strategy === 'equal') {
      next.equalPointCount = startN + added
    } else {
      // 每轮在当前最大弯矩段中点加一点，分走最热点一半灯
      const hotSeg = sol.segments.find((s) => s.index === sol.grade.maxStressSegIndex) || sol.segments[0]
      const x = Math.round((hotSeg.fromMm + hotSeg.toMm) / 2)
      let hot = next.groups[0]
      for (const g of next.groups) if (g.qty > hot.qty) hot = g
      const half = Math.max(1, Math.ceil(hot.qty / 2))
      hot.qty -= half
      if (hot.qty < 1) hot.qty = 1
      next.groups.push({ id: `DX${added}`, xMm: Math.min(next.rodLengthMm - 40, x), qty: half })
    }
    cur = effectiveSetup({ ...l, hanging: next })
    sol = solveStrategy(l, cur, cur.strategy, w)
  }
  return { sol, added, setup: cur }
}

/** 试挪灯：每轮把最大弯矩段附近最热的一盏向较近支座挪 1/3，直到过档或 6 轮 */
function simulateMoveLamp(l: Lantern, setup: HangingSetup, w: WeightBreakdown) {
  let cur: HangingSetup = JSON.parse(JSON.stringify(setup))
  let sol = solveStrategy(l, cur, 'load', w)
  let moved = 0
  const moves: string[] = []
  while (!sol.pass && moved < 8) {
    const next: HangingSetup = JSON.parse(JSON.stringify(cur))
    next.strategy = 'load'
    const xA = next.leftSupportMm
    const xB = next.rodLengthMm - next.rightSupportMm

    // 上拔工况：A 上拔说明右端（尤其右挑出端）太重，把最右的灯移回跨内；B 反之
    const upliftId = sol.grade.upliftSupports[0]
    if (upliftId) {
      const sorted = [...next.groups].sort((a, b) => (upliftId === 'A' ? b.xMm - a.xMm : a.xMm - b.xMm))
      const g = sorted[0]
      if (!g) break
      const innerTarget =
        upliftId === 'A'
          ? Math.max(xA + 1, xB - (xB - xA) / 3) // 移到右支座内侧 1/3 跨
          : Math.min(xB - 1, xA + (xB - xA) / 3)
      const target = Math.round(g.xMm + (innerTarget - g.xMm) / 2)
      g.xMm = target
      moves.push(`${g.id}→x=${fX(target)}mm（${upliftId === 'A' ? '右' : '左'}侧重载移回跨内，消上拔）`)
    } else {
      // 弯矩超档：把最热段附近的灯向较近支座挪 1/3
      const seg = sol.segments.find((s) => s.index === sol.grade.maxStressSegIndex) || sol.segments[0]
      const hot = next.groups.reduce(
        (p, c) => (c.xMm >= seg.fromMm && c.xMm <= seg.toMm ? c : p),
        next.groups.reduce((p, c) => (Math.abs(c.xMm - seg.maxAtMm) < Math.abs(p.xMm - seg.maxAtMm) ? c : p), next.groups[0])
      )
      const towardA = Math.abs(hot.xMm - xA) <= Math.abs(hot.xMm - xB)
      const target = Math.round(towardA ? xA + (hot.xMm - xA) / 3 : xB - (xB - hot.xMm) / 3)
      hot.xMm = target
      moves.push(`${hot.id}→x=${fX(target)}mm`)
    }
    moved += 1
    cur = effectiveSetup({ ...l, hanging: next })
    sol = solveStrategy(l, cur, 'load', w)
  }
  return { sol, moved, setup: cur, moves }
}

function projectFix(l: Lantern, setup: HangingSetup, w: WeightBreakdown, sol: StrategySolution): FixOption[] {
  const fixes: FixOption[] = []
  const hw = sol.hardware

  // 改法一：加挂点
  {
    const sim = simulateAddPoint(l, setup, w)
    const proj = sim.sol
    fixes.push({
      id: 'add-point',
      title: '改法一：加挂点（热点分摊，加到过档为止）',
      action:
        setup.strategy === 'equal'
          ? `挂点 ${setup.equalPointCount} → ${sim.setup.equalPointCount} 个，重新等分打孔`
          : `在最大弯矩段逐轮加点，共加 ${sim.added} 点`,
      pass: proj.pass,
      projectedMaxMNm: proj.maxMNm,
      projectedMaxStressRatio: proj.grade.maxStressRatio,
      addedRopeM: Math.round((proj.hardware.ropeTotalM - hw.ropeTotalM) * 100) / 100,
      addedRings: proj.hardware.ringTotalQty - hw.ringTotalQty,
      addedBraces: proj.hardware.braceQty - hw.braceQty,
      addedLaborMin: proj.hardware.laborMin - hw.laborMin,
      tradeoff: `多备 ${proj.hardware.ringTotalQty - hw.ringTotalQty} 个吊环、挂绳约多 ${(proj.hardware.ropeTotalM - hw.ropeTotalM).toFixed(2)}m、多打 ${proj.hardware.holeCount - hw.holeCount} 个孔，现场多 ${proj.hardware.laborMin - hw.laborMin} 分钟；灯一盏不挪、陈列间距不变，最省心，但杆上孔最多。`,
      nextSetup: sim.setup
    })
  }

  // 改法二：把灯挪开
  {
    const sim = simulateMoveLamp(l, setup, w)
    const proj = sim.sol
    fixes.push({
      id: 'move-lamp',
      title: '改法二：把灯挪开（热点的灯逐盏移向近支座）',
      action: sim.moves.length ? `挪动 ${sim.moved} 盏：${sim.moves.join('、')}` : '无需挪动',
      pass: proj.pass,
      projectedMaxMNm: proj.maxMNm,
      projectedMaxStressRatio: proj.grade.maxStressRatio,
      addedRopeM: Math.round((proj.hardware.ropeTotalM - hw.ropeTotalM) * 100) / 100,
      addedRings: proj.hardware.ringTotalQty - hw.ringTotalQty,
      addedBraces: proj.hardware.braceQty - hw.braceQty,
      addedLaborMin: Math.max(0, proj.hardware.laborMin - hw.laborMin),
      tradeoff: `不增加吊环与孔位（+${proj.hardware.ringTotalQty - hw.ringTotalQty} 环 / ${proj.hardware.holeCount - hw.holeCount} 孔，旧孔尽量 ±3mm 借位）；代价是灯间距被打乱、视觉要重排，被挪灯的绳长按新下垂点重配（${setup.strategy === 'equal' ? '且等分法要改为按吊重法逐点交代' : '仍为按吊重法'}），现场多 ${Math.max(0, proj.hardware.laborMin - hw.laborMin)} 分钟。`,
      nextSetup: sim.setup
    })
  }
  return fixes
}

// ===================== 三处变更对账 =====================

interface CommitSnapshot {
  points: { x: number; qty: number; t: number }[]
  segs: { a: number; b: number; m: number }[]
  ropes: Record<string, number>
  rings: Record<string, number>
  brace: number
}

type StoredCommit = HangingCommit & { snapshot?: CommitSnapshot }

function snapshotOf(sol: Pick<StrategySolution, 'points' | 'segments' | 'hardware'>): CommitSnapshot {
  return {
    points: sol.points.map((p) => ({ x: p.xMm, qty: p.qty, t: Math.round(p.tensionN * 10) / 10 })),
    segs: sol.segments.map((s) => ({
      a: s.fromMm,
      b: s.toMm,
      m: Math.round((s.maxNodeMNmm / 1000) * 100) / 100
    })),
    ropes: Object.fromEntries(sol.hardware.ropeLines.map((r) => [r.spec.id, r.lengthM])),
    rings: Object.fromEntries(sol.hardware.ringLines.map((r) => [r.spec.id, r.qty])),
    brace: sol.hardware.braceQty
  }
}

function buildChangeReport(setup: HangingSetup, sol: StrategySolution, digest: string): ChangeReport {
  const commit = setup.commit as StoredCommit | null
  if (!commit) {
    return {
      hasCommit: false,
      valid: true,
      reasons: [],
      holes: { oldHolesMm: [], reusedMm: [], reopenMm: [], addedMm: sol.hardware.holes.map((h) => h.xMm) },
      previewChanges: ['首次计算：全部挂点、拉力与各段弯矩均为新版（尚未按任何旧版打孔）'],
      materialChanges: ['首次计算：挂绳/吊环/加固件按本版出数'],
      exportChanges: ['首次计算：受力表与备料单全部行为新版'],
      exportStale: false
    }
  }

  const reasons: string[] = []
  if (commit.digest !== digest) reasons.push('输入摘要变化（蒙面材料 / 灯数 / 灯位 / 杆参数 / 档位之一改动），整杆重算')
  if (commit.strategy !== setup.strategy)
    reasons.push(`分摊法由「${commit.strategy === 'equal' ? '按挂点等分' : '按实际吊重分摊'}」换成「${setup.strategy === 'equal' ? '按挂点等分' : '按实际吊重分摊'}」`)
  if (commit.grade !== setup.grade) reasons.push(`安全档位由「${commit.grade}」改为「${setup.grade}」`)
  const valid = reasons.length === 0

  const old = commit.holesMm.slice().sort((a, b) => a - b)
  const now = sol.hardware.holes.map((h) => h.xMm).sort((a, b) => a - b)
  const reused: number[] = []
  const reopen: number[] = []
  old.forEach((x) => {
    const hit = now.find((n) => Math.abs(n - x) <= 3 && !reused.includes(n))
    if (hit) reused.push(hit)
    else reopen.push(x)
  })
  const added = now.filter((x) => !reused.includes(x))

  const snap = commit.snapshot
  const previewChanges: string[] = []
  const materialChanges: string[] = []
  const exportChanges: string[] = []
  sol.points.forEach((p, i) => {
    const oldP = snap?.points[i]
    const desc = `挂点 ${p.id}（x=${fX(p.xMm)}mm，${p.qty} 盏，拉力 ${fT(p.tensionN)}N）`
    if (!oldP) {
      previewChanges.push(`${desc}：新增挂点与拉力标注`)
      exportChanges.push(`受力表·挂点行 ${p.id}：新增`)
    } else if (oldP.x !== p.xMm || oldP.qty !== p.qty || Math.abs(oldP.t - Math.round(p.tensionN * 10) / 10) > 0.05) {
      previewChanges.push(`${desc}：位置/灯数/拉力标注变更（原 x=${fX(oldP.x)}mm，${oldP.qty} 盏，${fT(oldP.t)}N）`)
      exportChanges.push(`受力表·挂点行 ${p.id}：数值换新`)
    }
  })
  sol.segments.forEach((s, i) => {
    const oldS = snap?.segs[i]
    const m = Math.round((s.maxNodeMNmm / 1000) * 100) / 100
    const desc = `杆段 ${fX(s.fromMm)}–${fX(s.toMm)}mm（弯矩 ${fM(s.maxNodeMNmm)}N·m）`
    if (!oldS) {
      previewChanges.push(`${desc}：新增分段弯矩标注`)
      exportChanges.push(`受力表·分段行 段${s.index}：新增`)
    } else if (oldS.a !== s.fromMm || oldS.b !== s.toMm || Math.abs(oldS.m - m) > 0.005) {
      previewChanges.push(`${desc}：分段或弯矩标注变更（原 ${fX(oldS.a)}–${fX(oldS.b)}mm，${oldS.m.toFixed(2)}N·m）`)
      exportChanges.push(`受力表·分段行 段${s.index}：弯矩换新`)
    }
  })
  sol.hardware.ropeLines.forEach((r) => {
    const oldV = snap?.ropes[r.spec.id]
    if (oldV === undefined) {
      materialChanges.push(`${r.spec.name}：新增备 ${r.lengthM.toFixed(2)}m`)
      exportChanges.push(`备料单·「${r.spec.name}」行：新增`)
    } else if (Math.abs(oldV - r.lengthM) > 0.005) {
      materialChanges.push(`${r.spec.name}：米数 ${oldV.toFixed(2)}m → ${r.lengthM.toFixed(2)}m`)
      exportChanges.push(`备料单·「${r.spec.name}」行：米数换新`)
    }
  })
  sol.hardware.ringLines.forEach((r) => {
    const oldV = snap?.rings[r.spec.id] || 0
    if (oldV !== r.qty) {
      materialChanges.push(`${r.spec.name}：${oldV} → ${r.qty} 个`)
      exportChanges.push(`备料单·「${r.spec.name}」行：数量换新`)
    }
  })
  if ((snap?.brace ?? -1) !== sol.hardware.braceQty) {
    materialChanges.push(`钢套管加固件：${snap?.brace ?? 0} → ${sol.hardware.braceQty} 件`)
    exportChanges.push('备料单·「加固件」行：数量换新')
  }
  if (snap && snap.points.length > sol.points.length) {
    for (let i = sol.points.length; i < snap.points.length; i++) {
      previewChanges.push(`原第 ${i + 1} 个挂点已取消`)
      exportChanges.push(`受力表·原挂点行 ${i + 1}：作废`)
    }
  }
  if (!previewChanges.length && !valid) previewChanges.push('挂点位置与拉力数值未变，但旧版判定已整体作废，需重新确认存档')
  if (!materialChanges.length && !valid) materialChanges.push('吊挂件米数/个数未变，但旧版分组与配绳长度标记失效')
  if (!exportChanges.length && !valid) exportChanges.push('数值行未变，但旧受力表已标记作废，需重新导出')

  return {
    hasCommit: true,
    valid,
    reasons,
    holes: { oldHolesMm: old, reusedMm: reused, reopenMm: reopen, addedMm: added },
    previewChanges,
    materialChanges,
    exportChanges,
    exportStale: !!commit.exportedDigest && commit.exportedDigest !== digest
  }
}

// ===================== 自检（CHK-H1 ~ H6） =====================

function buildChecks(
  l: Lantern,
  sol: StrategySolution,
  w: WeightBreakdown,
  digest: string,
  mats: SingleLightMaterials,
  csvOk: boolean
): CheckResult[] {
  const out: CheckResult[] = []

  {
    const cov = coveringSpec(l.covering)
    const dCov = Math.abs(mats.coveringM2 * cov.weightGM2 - w.coveringG)
    const dFrame = Math.abs(mats.frameM * CAT.frameBamboo.weightGPerM - w.frameG)
    out.push({
      id: 'CHK-H1',
      title: '灯重同源：蒙面按面积、骨架按备料长度，与备料单重量一致',
      pass: dCov <= 0.01 && dFrame <= 0.01,
      value: `单灯 ${fG(w.totalG)}g / ${fT(w.totalN)}N（${w.totalKg.toFixed(3)}kg）`,
      detail:
        `蒙面 ${mats.coveringM2.toFixed(3)}m²×${cov.weightGM2}g/m² = ${fG(w.coveringG)}g；` +
        `骨架 ${mats.frameM.toFixed(3)}m×${CAT.frameBamboo.weightGPerM}g/m = ${fG(w.frameG)}g；` +
        `胶 ${fG(w.glueG)}g、扎线 ${fG(w.lashG)}g、LED ${fG(w.ledG)}g、小件 ${fG(w.fittingsG)}g；` +
        `合计 ${fG(w.totalG)}g → ${fT(w.totalN)}N。三处取的都是备料单同一组数，未按张数另估。`
    })
  }

  {
    const eq = sol.equilibrium
    out.push({
      id: 'CHK-H2',
      title: '支座反力与挑出端分开计算，Σ反力 = Σ荷载',
      pass: Math.abs(eq.residualN) <= 0.05 && eq.reactionDevPct <= 2,
      value: `R_A ${fT(sol.supports[0].reactionN)}N / R_B ${fT(sol.supports[1].reactionN)}N`,
      detail:
        `左支座 ${fT(sol.supports[0].reactionN)}N（挑出端 ${fX(sol.setup.leftSupportMm)}mm）、` +
        `右支座 ${fT(sol.supports[1].reactionN)}N（挑出端 ${fX(sol.setup.rightSupportMm)}mm）；` +
        `Σ反力 ${fT(eq.sumReactionN)}N，Σ荷载 ${fT(eq.totalLoadN)}N，残差 ${fT(eq.residualN)}N；` +
        `节点法与均布整杆反力偏差 ${eq.reactionDevPct.toFixed(2)}%（≤2%）。`
    })
  }

  {
    const eq = sol.equilibrium
    const interiorSegs = sol.segments.filter((s) => !s.maxAtEvent)
    out.push({
      id: 'CHK-H3',
      title: '弯矩逐段累加闭合，极值落在挂点/支座（或其跨内剪力零点）',
      pass: Math.abs(eq.tipClosureNmm) <= 1 && eq.extremumAtEvent,
      value: `杆端闭合 ${fM(eq.tipClosureNmm)}N·m / 逐段极值 vs 细采样偏差 ${eq.exactDevPct.toFixed(2)}%`,
      detail:
        `官方模型＝集中灯载 + 连续均布杆自重，支座反力与挑出端分开解；${sol.segments.length} 段逐段累加，集中灯载造成的弯矩转折全在挂点/支座，杆自重均布段的抛物线极值取剪力零点（${interiorSegs.length ? interiorSegs.map((s) => `段${s.index}@${fX(s.maxAtMm)}mm`).join('、') : '本杆极值均在挂点/支座'}）；` +
        `杆端 x=${fX(sol.setup.rodLengthMm)}mm 弯矩 ${fM(eq.tipClosureNmm)}N·m（自由端 ≈0）；逐段极值与 5mm 全杆细采样偏差 ${eq.exactDevPct.toFixed(2)}%；Σ反力−Σ荷载 ${fT(eq.residualN)}N。`
    })
  }

  {
    const g = sol.grade
    const segNames = g.failingSegments
      .map((i) => {
        const s = sol.segments[i - 1]
        return `第 ${i} 段（${fX(s.fromMm)}–${fX(s.toMm)}mm，${s.kind === 'span' ? '跨间' : '挑出端'}，弯矩 ${fM(s.maxNodeMNmm)}N·m）`
      })
      .join('、')
    const hot = sol.segments[g.maxStressSegIndex - 1]
    out.push({
      id: 'CHK-H4',
      title: `安全档位核定（${g.spec.name}）：应力 ≤ ${fS(g.limitStressMPa)}MPa、挠度 ≤ ${fX(g.allowDeflectionMm)}mm`,
      pass: g.pass,
      value: g.pass ? `最大应力利用 ${(g.maxStressRatio * 100).toFixed(0)}%` : `超档：${segNames || g.upliftSupports.join('、') + ' 支座上拔'}`,
      detail: g.pass
        ? `最大弯矩 ${fM(sol.maxMNm * 1000)}N·m，应力峰值 ${fS(hot?.stressMPa || 0)}MPa（利用 ${(g.maxStressRatio * 100).toFixed(0)}%）；挠度峰值 ${fT(g.maxDeflectionMm)}mm / 限值 ${fX(g.allowDeflectionMm)}mm。`
        : `超档位段：${segNames || '无'}${g.upliftSupports.length ? `；支座 ${g.upliftSupports.join('、')} 反力为负（挑出端压过跨内，需压重/锚固）` : ''}。见下方两条改法。`
    })
  }

  {
    const digest2 = hangingDigest(l, sol.setup, w)
    out.push({
      id: 'CHK-H5',
      title: '三处取数同源：预览页 / 材料页 / 导出清单为同一 digest',
      pass: digest === digest2 && csvOk,
      value: digest,
      detail: `参数与灯体预览页、备料统计与材料页、导出清单均由 computeHanging() 同一次结果驱动；受力表与备料单 CSV 内嵌同一指纹 ${digest}，同一挂点拉力与同一段弯矩在三处不允许有出入。`
    })
  }

  {
    const commit = sol.setup.commit
    if (!commit) {
      out.push({
        id: 'CHK-H6',
        title: '旧版布置状态：尚无存档（未打孔）',
        pass: true,
        value: '未存档',
        detail: '还没有「确认采用」过任何版本，现场横杆上没有已登记的挂点孔；确认本版后会把孔位、分组、安全余量判定与配绳长度一并存档。'
      })
    } else {
      const valid = commit.digest === digest && commit.strategy === sol.setup.strategy && commit.grade === sol.setup.grade
      out.push({
        id: 'CHK-H6',
        title: '旧版布置作废与孔位重开核定',
        pass: valid,
        value: valid ? '存档版本有效' : '旧版已作废，需重开孔',
        detail: valid
          ? `存档于 ${new Date(commit.committedAt).toLocaleString()}，摘要 ${digest} 一致；${commit.exportedDigest ? '受力表已导出且同为新版。' : '尚未导受力表。'}`
          : `本机存档（${new Date(commit.committedAt).toLocaleString()}）的挂点布置、分组、安全余量判定与配绳长度已全部失效；旧孔 ${commit.holesMm.map(fX).join('、') || '无'}mm 中无法借位的要重开，已导出的旧受力表${commit.exportedDigest ? '（' + commit.exportedDigest + '）' : ''}一并作废。`
      })
    }
  }

  return out
}

// ===================== 主入口 =====================

export function computeHanging(l: Lantern): HangingResult {
  const mats = computeMaterials(l)
  const w = lanternWeight(l, mats)
  const input = effectiveSetup(l)

  const chosen = solveStrategy(l, input, input.strategy, w)
  const otherId: HangingStrategyId = input.strategy === 'equal' ? 'load' : 'equal'
  // 另一条路用其自身的候选布置（按吊重法首次切入时自动均布一次），不覆盖当前存档
  const otherOverride =
    otherId === 'load' ? placeByLoad(l, input) : effectiveSetup({ ...l, hanging: { ...input, strategy: 'equal' } })
  const other = solveStrategy(l, input, otherId, w, otherOverride)

  const chosenRod = cheapestPassingRod(l, chosen.setup, w)
  const otherRod = cheapestPassingRod(l, other.setup, w, otherOverride)
  const tradeChosen = toSummary(input.strategy, chosen, chosenRod.rod, chosenRod.price)
  const tradeRejected = toSummary(otherId, other, otherRod.rod, otherRod.price)

  const digest = hangingDigest(l, chosen.setup, w)
  const fixes = chosen.pass ? [] : projectFix(l, chosen.setup, w, chosen)
  const change = buildChangeReport(chosen.setup, chosen, digest)

  const rejectedYield: string[] = []
  const rodChosenName = chosenRod.rod?.name || '（现有档杆都不过，需另议）'
  const rodRejectedName = otherRod.rod?.name || '（现有档杆都不过，需另议）'
  if (chosenRod.rod?.id !== otherRod.rod?.id) {
    const dPrice = tradeRejected.rodPrice - tradeChosen.rodPrice
    rejectedYield.push(
      `放弃「${tradeRejected.name}」的杆料代价：它过档要用 ${rodRejectedName}（约 ${tradeRejected.rodPrice.toFixed(2)} 元/根），本版用 ${rodChosenName}（约 ${tradeChosen.rodPrice.toFixed(2)} 元/根），${dPrice >= 0 ? `让出差价 ${dPrice.toFixed(2)} 元/根` : `反而贵出 ${(-dPrice).toFixed(2)} 元/根`}`
    )
  } else {
    rejectedYield.push(`两条路用同一档杆料（${rodChosenName}，约 ${tradeChosen.rodPrice.toFixed(2)} 元/根），放弃「${tradeRejected.name}」在杆料上不产生差价`)
  }
  const dLabor = tradeRejected.laborMin - tradeChosen.laborMin
  rejectedYield.push(
    `现场工时：${tradeRejected.name} 约 ${tradeRejected.laborMin} 分钟、本版 ${tradeChosen.laborMin} 分钟；放弃它${dLabor >= 0 ? `让出 ${dLabor} 分钟现场工` : `反而要多花 ${-dLabor} 分钟（本版吊法要逐点交代）`}`
  )

  const result: HangingResult = {
    setup: chosen.setup,
    weight: w,
    rod: rodSpec(input.rodId),
    section: sectionProps(rodSpec(input.rodId)),
    points: chosen.points,
    supports: chosen.supports,
    segments: chosen.segments,
    grade: chosen.grade,
    hardware: chosen.hardware,
    fixes,
    pass: chosen.pass,
    tradeoff: {
      chosen: tradeChosen,
      rejected: tradeRejected,
      rejectedYieldText: rejectedYield.join('；'),
      chosenCostText:
        `本版「${tradeChosen.name}」：${tradeChosen.pointCount} 点、绳 ${tradeChosen.ropeTotalM.toFixed(2)}m、吊环 ${tradeChosen.ringTotalQty} 个、加固 ${tradeChosen.braceQty} 件、现场 ${tradeChosen.laborMin} 分钟；` +
        `最大弯矩 ${tradeChosen.maxMNm.toFixed(2)}N·m、应力利用 ${(tradeChosen.maxStressRatio * 100).toFixed(0)}%。`
    },
    digest,
    change,
    equilibrium: chosen.equilibrium,
    checks: []
  }
  // 三处同源：用完整结果生成两份 CSV，必须内嵌同一指纹（CHK-H5 用）
  const batch = computeBatch(mats, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const csvOk = forceTableCsv(l, result).includes(digest) && materialsCsv(l, mats, batch, result).includes(digest)
  result.checks = buildChecks(l, chosen, w, digest, mats, csvOk)
  return result
}

// ===================== 存档 / 导出登记 =====================

export function commitHanging(l: Lantern, result: HangingResult): void {
  const snap = snapshotOf({ points: result.points, segments: result.segments, hardware: result.hardware })
  const commit: StoredCommit = {
    strategy: result.setup.strategy,
    digest: result.digest,
    holesMm: result.hardware.holes.map((h) => h.xMm),
    grade: result.setup.grade,
    committedAt: new Date().toISOString(),
    snapshot: snap
  }
  if (!l.hanging) l.hanging = defaultHangingSetup(l)
  l.hanging.strategy = result.setup.strategy
  l.hanging.grade = result.setup.grade
  l.hanging.commit = commit
}

export function markForceExported(l: Lantern, result: HangingResult): void {
  if (!l.hanging) l.hanging = result.setup
  if (!l.hanging.commit) {
    l.hanging.commit = {
      strategy: result.setup.strategy,
      digest: result.digest,
      holesMm: result.hardware.holes.map((h) => h.xMm),
      grade: result.setup.grade,
      committedAt: new Date().toISOString()
    }
  }
  l.hanging.commit.exportedDigest = result.digest
  l.hanging.commit.exportedAt = new Date().toISOString()
}
