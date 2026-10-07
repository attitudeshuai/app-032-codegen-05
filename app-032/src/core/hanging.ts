/**
 * 挂点布置与受力核定（门廊横杆挂一串花灯）
 *
 * 数据纪律（规格要求）：
 *  - 灯重不另估：每盏灯的重量取自 computeMaterials() 的 totalWeightG ——
 *    蒙面重 = 既有裁片（含缝份）面积 × 同一份材料清单面密度；
 *    骨架重 = 既有备料总长 × 同一份清单线密度。受力模块绝不按张数另估。
 *  - 三处同源：预览页（参数与灯体预览）、材料页（备料统计）、导出清单全部只调用
 *    本模块的 computeHanging() 同一个返回对象；同一挂点拉力、同一段弯矩在三处无出入。
 *  - 一改全算：蒙面材料、加灯、挪灯、杆长/支座/档位/分摊方式任何一项变化，
 *    整杆重算并产生新的版本号（revision）；旧版布置、旧孔位、旧受力表标记作废。
 *
 * 力学口径：
 *  - 重量先按克（g）记账、换算成牛（F = m·g，g=9.81）参与受力，展示再换算千克；
 *  - 长度 mm（挂点位置取整到 1mm），拉力保留 1 位小数 N，弯矩保留 1 位小数 N·m；
 *  - 支座反力与两端挑出端分开算（挑出端无支座，弯矩反号）；
 *  - 弯矩沿杆从左端逐点累加（集中力模型，均布杆自重按各关键点间分布积分），
 *    极值只可能落在挂点或支座处；逐段累加结果与整杆平衡（右端 M=0、反力和=总载）核对一致。
 */
import type { Lantern } from './types'
import {
  BEAM_SECTIONS,
  CRAFT,
  SAFETY_TIERS,
  beamSectionSpec,
  coveringSpec,
  safetyTierSpec,
  type BeamSectionSpec,
  type SafetyTierSpec
} from './craft'
import { computeMaterials } from './materials'
import { r1, r3 } from './geometry'

// ---------------------------------------------------------------- 数据模型

export type DistributionStrategy = 'even' | 'weighted'
export type RopeStyle = 'straight' | 'bridle'
export type LoadSeverity = 'ok' | 'over'

/** 横杆上要挂的一盏灯（用户编辑的挂灯清单，序号即原始顺序） */
export interface HangingItem {
  id: string
  /** 灯样 id（对应 store 里的 Lantern） */
  lanternId: string
  name: string
  /** 灯样快照参数（保证与该灯蒙面/骨架重量同源；灯样改动后重量自动重算） */
  /** 期望位置（mm，距杆左端）；加权分摊时作为目标位置，分组中心会尽量贴近 */
  desiredX: number
  /** 用户手改单灯数量（同一灯样挂几盏），默认 1 */
  qty: number
  /** 单灯重量快照（g，来自 computeMaterials，禁止本模块另估） */
  unitWeightG: number
  /** 蒙面名称（重量出处说明，三处同源可追溯） */
  coveringName: string
  /** 蒙面面积（含缝份，m²，与备料单同一口径） */
  coveringM2: number
}

export interface BeamConfig {
  /** 横杆总长（mm） */
  lengthMm: number
  /** 左支座距杆左端（mm）；左侧挑出端 = 该值 */
  leftSupportMm: number
  /** 右支座距杆左端（mm）；右侧挑出端 = lengthMm - 该值 */
  rightSupportMm: number
  /** 横杆截面规格 id（beamSections） */
  sectionId: string
  /** 安全档位 id（safetyTiers） */
  tierId: string
  /** 是否把横杆自重计入受力 */
  includeBeamWeight: boolean
  /** 挂绳走法：直吊（每点一根竖绳）/ 双股斜吊（每点两根） */
  ropeStyle: RopeStyle
  /** 挂绳竖直投影长度（mm，横杆到灯吊点） */
  ropeDropMm: number
  /** 斜吊时绳与横杆夹角（度），用于逐点配绳 */
  bridleAngleDeg: number
}

export interface HangingGroup {
  /** 挂点编号 H1、H2…（按位置从左到右，版本内稳定） */
  id: string
  /** 挂点位置（mm，距杆左端，取整） */
  xMm: number
  itemIds: string[]
  /** 该点灯数 */
  lanternCount: number
  /** 该点总重（g）= Σ 单灯重 × 数量 */
  weightG: number
  /** 该点总重（kg，展示） */
  weightKg: number
  /** 重力荷载（N） */
  loadN: number
  /** 单根挂绳拉力（N，1 位小数）；直吊=荷载，斜吊=荷载/2/sinθ */
  ropeTensionN: number
  /** 每根绳长度（mm，取整）：直吊=落差；斜吊=落差/sinθ */
  ropePerLegMm: number
  /** 该点绳股数（直吊 1 / 斜吊 2） */
  legs: number
  /** 该点配绳总长（mm）= 单根 × 股数 */
  ropeTotalMm: number
  /** 该点吊环数（直吊 1 / 斜吊 2） */
  rings: number
  /** 逐点吊法交代（加权分摊时每点绳索要逐点写明） */
  riggingNote: string
}

export interface BeamPoint {
  xMm: number
  kind: 'bar_end' | 'support' | 'hanger'
  refId: string
}

export interface BeamSegment {
  /** 段编号 S1…（从左到右，按关键点切分；位置变了编号即失效，随版本作废） */
  id: string
  fromX: number
  toX: number
  /** 段长（mm，取整展示，内部用精确值） */
  lengthMm: number
  /** 所属区间：左挑出端 / 跨内 / 右挑出端 */
  zone: 'left_overhang' | 'span' | 'right_overhang'
  /** 左端截面弯矩（N·m，1 位小数） */
  momentStartNm: number
  /** 右端截面弯矩（N·m） */
  momentEndNm: number
  /** 段内弯矩极值（N·m，绝对值） */
  momentPeakNm: number
  /** 极值落在哪一端（挂点或支座处） */
  peakAt: 'start' | 'end'
  /** 该段剪力（N，集中力模型下整段恒定；含杆自重时线性变化，取端值包络） */
  shearN: number
  pass: boolean
  /** 容许弯矩（N·m，1 位小数）= 抗弯设计值 × 截面模量 / 安全系数 */
  allowableNm: number
  /** 利用率 = 极值/容许 */
  utilization: number
  /** 超限点名文案 */
  overLabel: string
}

export interface SupportReaction {
  id: string
  xMm: number
  /** 支座反力（N，1 位小数） */
  reactionN: number
  /** 折合千克（展示） */
  reactionKg: number
}

export interface OverSegmentFix {
  kind: 'add_point' | 'move_lantern'
  title: string
  /** 代价说明（加挂点：杆料/加固不变但多孔多绳多工；挪灯：不开新孔但要重新配灯位） */
  cost: string
  /** 取舍说明 */
  tradeoff: string
  /** 模拟后的整杆结果（与当前版同口径重算） */
  simulated: HangingResult
  /** 模拟后最大利用率 */
  simulatedPeakUtil: number
  /** 模拟后是否全部合格 */
  simulatedPass: boolean
}

export interface SegmentCheck {
  segmentId: string
  zone: BeamSegment['zone']
  peakNm: number
  allowableNm: number
  utilization: number
  pass: boolean
  fixes: OverSegmentFix[]
}

/** 挂装备料（挂绳、吊环、加固件）——材料页与导出取这同一份 */
export interface RiggingMaterials {
  /** 挂点总数（= 孔位数） */
  pointCount: number
  /** 吊环总数 */
  ringCount: number
  /** 挂绳总长（m，含损耗） */
  ropeM: number
  /** 挂绳净重（m，不含损耗） */
  ropeRawM: number
  /** 支座固定夹数量（每支座 1 副，共 2） */
  clampCount: number
  /** 加固件数量：每个超限段 1 件；合格时 0（加挂点/挪灯后可清零） */
  stiffenerCount: number
  stiffenerSegmentIds: string[]
  /** 挂绳重量（g，含损耗） */
  ropeWeightG: number
  /** 吊环重量（g，含损耗） */
  ringWeightG: number
  /** 固定夹重量（g，含损耗） */
  clampWeightG: number
  /** 加固件重量（g，含损耗） */
  stiffenerWeightG: number
  /** 挂装五金合计重量（g） */
  totalRiggingWeightG: number
  /** 横杆备料长度（mm，= 杆长，一整根） */
  beamStockMm: number
  /** 横杆自重（kg） */
  beamWeightKg: number
}

/** 两种分摊方式的代价对比（被放弃的那条路写明让出多少杆料/现场工） */
export interface StrategyTradeoff {
  strategy: DistributionStrategy
  label: string
  pointCount: number
  /** 不同配绳规格数（直吊且落差一致时为 1；斜吊每点角度/落差不同则逐点不同） */
  ropeSpecKinds: number
  /** 现场工时（分钟，含打孔/挂装/逐点系绳） */
  laborMinutes: number
  /** 工时构成说明 */
  laborNote: string
  /** 全杆最大弯矩（N·m） */
  peakNm: number
  /** 为该弯矩需要的截面模量（mm³）= 峰值×1000×安全系数/抗弯设计值 */
  requiredSectionModulusMm3: number
  /** 现有截面模量（mm³） */
  actualSectionModulusMm3: number
  /** 现有杆是否够用 */
  beamEnough: boolean
  /** 若不够，理论上需加大的杆料线密度差（g/m，正值=要加的杆料；负值=可让出的杆料） */
  beamStockDeltaGPerM: number
  /** 杆料代价说明（含「让出多少杆料」的表述） */
  beamNote: string
  pass: boolean
}

export interface ChangeEntry {
  /** 预览页变化：挂点编号 + 拉力（新增/移除/数值变动） */
  preview: string[]
  /** 材料页变化：吊挂件项与米数 */
  materials: string[]
  /** 导出清单变化：受力表/备料单的行 */
  exports: string[]
}

export interface HangingResult {
  /** 数据版本（每次整杆重算 +1；旧版结果、旧孔位、旧分组、旧配绳随之作废） */
  revision: number
  generatedAt: string
  strategy: DistributionStrategy
  beam: BeamConfig
  section: BeamSectionSpec
  tier: SafetyTierSpec
  /** 截面模量（mm³） */
  sectionModulusMm3: number
  items: HangingItem[]
  groups: HangingGroup[]
  supports: SupportReaction[]
  segments: BeamSegment[]
  points: BeamPoint[]
  checks: SegmentCheck[]
  rigging: RiggingMaterials
  /** 总挂重（kg，不含杆自重与挂装五金） */
  totalLanternKg: number
  /** 杆上全部竖直荷载（N，含杆自重） */
  totalLoadN: number
  /** 全杆弯矩极值（N·m） */
  globalPeakNm: number
  /** 极值位置（mm） */
  globalPeakXMm: number
  allPass: boolean
  /** 整杆平衡核对：反力和 vs 总载（N，差应≈0） */
  balanceDeltaN: number
  /** 右端弯矩（应≈0），逐段累加与整杆核算一致性的证据 */
  endMomentNm: number
  /** 两种分摊方式的代价与取舍（当前方案 + 被放弃方案各一份） */
  tradeoffs: Record<DistributionStrategy, StrategyTradeoff>
  /** 本版相对上一版：三处各变了什么 */
  changes: ChangeEntry
  /** 作废说明（旧版布置/孔位/受力表/分组/安全判定/配绳长度） */
  voidedNote: string
  /** 重量出处口径（三处同源的书面交代） */
  weightProvenance: string
  unitsNote: string
}

/** 全杆最大段利用率（0~∞，>1 即有超限段；改法模拟对比用） */
export function utilizationMaxOf(r: HangingResult): number {
  return r.segments.reduce((m, s) => Math.max(m, s.utilization), 0)
}

// ---------------------------------------------------------------- 常量与工具

const G = CRAFT.gravity

/** 长度按毫米取整（挂点孔位） */
const ri = (v: number) => Math.round(v)
/** 拉力/剪力 1 位小数（N） */
const n1 = (v: number) => Math.round(v * 10) / 10
/** 弯矩 1 位小数（N·m） */
const nm1 = (v: number) => Math.round(v * 10) / 10

export function defaultBeamConfig(): BeamConfig {
  return {
    lengthMm: 3000,
    leftSupportMm: 300,
    rightSupportMm: 2700,
    sectionId: BEAM_SECTIONS[0].id,
    tierId: SAFETY_TIERS[1].id,
    includeBeamWeight: true,
    ropeStyle: 'straight',
    ropeDropMm: 600,
    bridleAngleDeg: 45
  }
}

/** 截面模量（mm³）：圆管 W=π(D⁴-d⁴)/(32D)；矩形 W=b·h²/6（h 为竖直高） */
export function sectionModulus(s: BeamSectionSpec): number {
  if (s.shape === 'circle') {
    const D = s.diameterMm || 0
    const d = s.innerDiameterMm || 0
    return (Math.PI * (D ** 4 - d ** 4)) / (32 * Math.max(1, D))
  }
  const b = s.widthMm || 0
  const h = s.heightMm || 0
  return (b * h ** 2) / 6
}

export function allowableMomentNm(s: BeamSectionSpec, tier: SafetyTierSpec): number {
  const W = sectionModulus(s)
  // MPa(N/mm²) × mm³ = N·mm → /1000 = N·m，再除安全系数
  return nm1((s.allowableBendingMPa * W) / tier.factor / 1000)
}

// ---------------------------------------------------------------- 分组：两种分摊

interface LoadItem {
  item: HangingItem
  weightG: number // qty × unitWeightG
}

/** 按挂点等分：孔位等距，灯按期望位置排序后连续装桶（布置简单、孔位等距、现场好挂） */
function groupEven(items: LoadItem[], beam: BeamConfig, insertX?: number): HangingGroup[] {
  if (items.length === 0) return []
  const totalQty = items.reduce((s, x) => s + Math.max(1, x.item.qty), 0)
  // 每个挂点挂 1~2 盏：点数 = ceil(总盏数/2)，但不少于 3 点（避免全部堆到支座/两端）
  const basePoints = Math.min(totalQty, Math.max(3, Math.ceil(totalQty / 2)))
  let pointCount = insertX !== undefined ? Math.min(totalQty, basePoints + 1) : basePoints
  // 孔位在两支座之间等距（首点与末点内缩半个间距，不压在支座上）
  const span = beam.rightSupportMm - beam.leftSupportMm
  let xs: number[]
  if (insertX !== undefined) {
    // 改法模拟：插入一个新孔（点位集合含新孔，点数 = 基础 +1，上限为总盏数）
    const baseCount = pointCount - 1
    const base = Array.from({ length: baseCount }, (_, k) => beam.leftSupportMm + (span * (k + 0.5)) / baseCount)
    xs = [...base, Math.max(beam.leftSupportMm + 1, Math.min(beam.rightSupportMm - 1, insertX))].sort((a, b) => a - b)
  } else {
    xs = Array.from({ length: pointCount }, (_, k) => beam.leftSupportMm + (span * (k + 0.5)) / pointCount)
  }
  const buckets: LoadItem[][] = Array.from({ length: pointCount }, () => [])
  if (insertX !== undefined) {
    // 加孔模拟：灯先按最近孔归组（保证空间有序），再做相邻孔的负载搬运均衡——
    // 把超载孔里最靠邻孔的灯移给相邻轻孔，迭代到最大组载不再下降。
    // 这样新孔（位于超限段中点）一定承接该段两侧的灯，既空间有序又把该段弯矩削下来。
    for (const it of [...items].sort((a, b) => a.item.desiredX - b.item.desiredX)) {
      let bi = 0
      let best = Infinity
      xs.forEach((x, k) => {
        const d = Math.abs(x - it.item.desiredX)
        if (d < best) {
          best = d
          bi = k
        }
      })
      buckets[bi].push(it)
    }
    const wOf = (b: LoadItem[]) => b.reduce((s, x) => s + x.weightG, 0)
    for (let pass = 0; pass < 30; pass++) {
      const ws = buckets.map(wOf)
      let acted = false
      for (let k = 0; k < pointCount; k++) {
        if (buckets[k].length === 0) continue
        // 找当前最重的孔与其相邻更轻孔，把边界处的灯移过去
        const nbs = [k - 1, k + 1].filter((j) => j >= 0 && j < pointCount)
        let target = -1
        for (const j of nbs) if (ws[j] < ws[k] - 1e-9 && (target < 0 || ws[j] < ws[target])) target = j
        if (target < 0) continue
        // 取该孔中最靠近邻孔、移走后两孔更均衡的一盏
        const idx = buckets[k]
          .map((it, i) => ({ i, d: Math.abs(it.item.desiredX - xs[target]) }))
          .sort((a, b) => a.d - b.d)[0].i
        const it = buckets[k][idx]
        if (ws[k] - it.weightG >= ws[target] + it.weightG) {
          // 移过去反而过头，停止这对
          continue
        }
        buckets[target].push(it)
        buckets[k].splice(idx, 1)
        ws[k] -= it.weightG
        ws[target] += it.weightG
        acted = true
      }
      if (!acted) break
    }
  } else {
    // 连续装桶：按灯位从左到右分到等距孔位，每桶灯数尽量相等（按总盏数而非条目，使组重更匀）
    const byX = [...items].sort((a, b) => a.item.desiredX - b.item.desiredX)
    const totalQty = byX.reduce((s, x) => s + Math.max(1, x.item.qty), 0)
    let acc = 0
    let bi = 0
    for (const it of byX) {
      if (bi < pointCount - 1 && acc >= ((bi + 1) * totalQty) / pointCount) bi += 1
      buckets[bi].push(it)
      acc += Math.max(1, it.item.qty)
    }
  }
  return finishGroups(buckets, xs, beam)
}

/**
 * 按实际吊重分摊：贪心把灯（按重降序）放进「当前组重最小」的组，
 * 位置按组重加权落在两支座之间，使各段弯矩尽量均匀、杆更省；
 * 每点灯数与配绳逐点交代。
 */
function groupWeighted(items: LoadItem[], beam: BeamConfig, insertX?: number): HangingGroup[] {
  if (items.length === 0) return []
  const totalQty = items.reduce((s, x) => s + Math.max(1, x.item.qty), 0)
  const basePoints = Math.min(totalQty, Math.max(3, Math.ceil(totalQty / 2)))
  const pointCount = insertX !== undefined ? Math.min(totalQty, basePoints + 1) : basePoints
  const ordered = [...items].sort((a, b) => b.weightG - a.weightG)
  const buckets: LoadItem[][] = Array.from({ length: pointCount }, () => [])
  const sums = new Array(pointCount).fill(0)
  for (const it of ordered) {
    let j = 0
    for (let k = 1; k < pointCount; k++) if (sums[k] < sums[j]) j = k
    buckets[j].push(it)
    sums[j] += it.weightG
  }
  // 非空组按其成员期望位置的重心排序，再在支座间按组重等弯矩趋势布点：
  // 位置取成员期望位置的加权重心，并夹在支座内；孔位取整。
  let groups: { items: LoadItem[]; cx: number }[] = []
  for (const b of buckets) {
    if (!b.length) continue
    const wsum = b.reduce((s, x) => s + x.weightG, 0)
    const cx = b.reduce((s, x) => s + x.item.desiredX * x.weightG, 0) / wsum
    groups.push({ items: b, cx })
  }
  groups.sort((a, b) => a.cx - b.cx)
  // 改法模拟：在指定位置补一个孔，把最近的最重灯移到该孔（保证该点不空、孔被利用）
  if (insertX !== undefined) {
    const x = Math.max(beam.leftSupportMm + 1, Math.min(beam.rightSupportMm - 1, insertX))
    let donor = groups[0]
    let best = -1
    for (const g of groups) {
      const w = g.items.reduce((s, it) => s + it.weightG, 0)
      if (w > best && g.items.length > 0) {
        best = w
        donor = g
      }
    }
    if (donor && donor.items.length) {
      const moved = donor.items.splice(0, 1)
      groups.push({ items: moved, cx: x })
      groups = groups.filter((g) => g.items.length)
      groups.sort((a, b) => a.cx - b.cx)
    }
  }
  // 把重心位置重铺到支座区间内（保留相对次序，等距保底，重心做微调）
  const span = beam.rightSupportMm - beam.leftSupportMm
  const xs = groups.map((g) =>
    insertX !== undefined && Math.abs(g.cx - insertX) < 1
      ? insertX
      : beam.leftSupportMm + (span * (groups.indexOf(g) + 0.5)) / groups.length
  )
  return finishGroups(
    groups.map((g) => g.items),
    xs,
    beam
  )
}

function finishGroups(buckets: LoadItem[][], xs: number[], beam: BeamConfig): HangingGroup[] {
  const theta = (beam.ropeStyle === 'bridle' ? Math.max(5, beam.bridleAngleDeg) : 90) * (Math.PI / 180)
  const legs = beam.ropeStyle === 'bridle' ? 2 : 1
  const out: HangingGroup[] = []
  buckets.forEach((b, i) => {
    if (!b.length) return
    const weightG = b.reduce((s, x) => s + x.weightG, 0)
    const loadN = (weightG / 1000) * G
    const ropeTensionN = loadN / legs / Math.sin(theta)
    const ropePerLegMm = beam.ropeStyle === 'bridle' ? beam.ropeDropMm / Math.sin(theta) : beam.ropeDropMm
    const xMm = ri(xs[i])
    const rings = legs
    out.push({
      id: `H${i + 1}`,
      xMm,
      itemIds: b.map((x) => x.item.id),
      lanternCount: b.reduce((s, x) => s + x.item.qty, 0),
      weightG: r1(weightG),
      weightKg: r3(weightG / 1000),
      loadN: n1(loadN),
      ropeTensionN: n1(ropeTensionN),
      ropePerLegMm: ri(ropePerLegMm),
      legs,
      ropeTotalMm: ri(ropePerLegMm) * legs,
      rings,
      riggingNote:
        beam.ropeStyle === 'bridle'
          ? `双股斜吊，与横杆夹角 ${beam.bridleAngleDeg}°，每股绳长 ${ri(ropePerLegMm)}mm、受力 ${n1(
              ropeTensionN
            )}N，孔位两侧各装 1 只吊环`
          : `竖直单吊，绳长 ${ri(ropePerLegMm)}mm、受力 ${n1(ropeTensionN)}N，孔位装 1 只吊环`
    })
  })
  // 按孔位从左到右重排并重编号（版本内稳定）
  out.sort((a, b) => a.xMm - b.xMm)
  out.forEach((g, i) => (g.id = `H${i + 1}`))
  return out
}

// ---------------------------------------------------------------- 受力：支座反力 + 逐段弯矩

interface KeyPoint {
  x: number
  kind: BeamPoint['kind']
  refId: string
  /** 该点向下集中力（N）：挂点荷载 */
  pN: number
  /** 该点向上支座反力（N），求解后回填 */
  rN: number
}

function buildKeyPoints(beam: BeamConfig, groups: HangingGroup[], udlNPerMm: number): KeyPoint[] {
  const pts: KeyPoint[] = [
    { x: 0, kind: 'bar_end', refId: 'L0', pN: 0, rN: 0 },
    { x: beam.leftSupportMm, kind: 'support', refId: 'SA', pN: 0, rN: 0 },
    { x: beam.rightSupportMm, kind: 'support', refId: 'SB', pN: 0, rN: 0 },
    { x: beam.lengthMm, kind: 'bar_end', refId: 'L1', pN: 0, rN: 0 }
  ]
  for (const g of groups) {
    pts.push({ x: g.xMm, kind: 'hanger', refId: g.id, pN: (g.weightG / 1000) * G, rN: 0 })
  }
  pts.sort((a, b) => a.x - b.x || (a.kind === 'support' ? -1 : 1))
  // 标注：均布杆自重以 udl 形式在积分中处理（不折算成集中力，避免重复）
  void udlNPerMm
  return dedupeSorted(pts)
}

/** 同坐标点合并（灯孔与支座重合时），支座保留在最前 */
function dedupeSorted(pts: KeyPoint[]): KeyPoint[] {
  const out: KeyPoint[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 1e-9) {
      last.pN += p.pN
      if (p.kind === 'support' && last.kind !== 'support') {
        last.kind = 'support'
        last.refId = p.refId
      }
    } else out.push({ ...p })
  }
  return out
}

/**
 * 两支座简支梁（带两端挑出）的反力与逐截面弯矩。
 * 集中荷载为挂点；横杆自重为全杆均布荷载 q（N/mm）。
 * 对左支座取矩求右支座反力 Rb，再用竖直平衡求 Ra：
 *   ΣM_A = 0 → Rb·(B-A) = Σ Pᵢ(xᵢ-A) + q·L·(L/2-A)
 */
function solve(beam: BeamConfig, groups: HangingGroup[], section: BeamSectionSpec) {
  const A = beam.leftSupportMm
  const B = beam.rightSupportMm
  const L = beam.lengthMm
  const q = beam.includeBeamWeight ? ((section.weightGPerM / 1000) * G) / 1000 : 0 // N/mm
  const totalBeamN = q * L
  const totalP = groups.reduce((s, g) => s + (g.weightG / 1000) * G, 0)
  const totalLoad = totalP + totalBeamN

  // 对 A 取矩（顺时针为正，挑出端荷载力臂为负）
  let momentAboutA = 0
  for (const g of groups) momentAboutA += ((g.weightG / 1000) * G) * (g.xMm - A)
  momentAboutA += totalBeamN * (L / 2 - A)
  const Rb = B > A ? momentAboutA / (B - A) : 0
  const Ra = totalLoad - Rb

  const kps = buildKeyPoints(beam, groups, q)
  const at = new Map<number, KeyPoint>()
  for (const p of kps) at.set(p.x, p)
  const supA = kps.find((p) => p.refId === 'SA')
  const supB = kps.find((p) => p.refId === 'SB')
  if (supA) supA.rN = Ra
  if (supB) supB.rN = Rb

  // 从左端 x=0 逐点累加：段内剪力 V，弯矩 M(x₂)=M(x₁)+V·Δx+q·Δx²/2；
  // 经过关键点时先结算该点集中力（反力向上 +，荷载向下 -），再进入下一段。
  const xlist = kps.map((p) => p.x)
  const M = new Map<number, number>()
  const Vleft = new Map<number, number>() // 该点以右紧邻截面的剪力（段剪力）
  let Mx = 0
  let V = 0 // 左端自由：剪力 0，第一点之前仅有均布杆重
  for (let i = 0; i < kps.length; i++) {
    const p = kps[i]
    const dx = i === 0 ? 0 : p.x - kps[i - 1].x
    Mx = Mx + V * dx - (q * dx * dx) / 2
    M.set(p.x, Mx)
    // 计入该点集中力后，进入右侧相邻段的剪力
    V = V - q * dx + (p.kind === 'support' ? p.rN : 0) - (p.kind === 'hanger' ? p.pN : 0)
    Vleft.set(p.x, V)
  }
  // 右端闭合核对：最后一点应为杆末端，其 M 应≈0
  const endMoment = M.get(L) ?? 0
  const balanceDelta = Ra + Rb - totalLoad

  return { kps, xlist, M, Vleft, Ra, Rb, q, totalLoad, totalP, totalBeamN, endMoment, balanceDelta }
}

// ---------------------------------------------------------------- 主计算

let revisionCounter = 0
/** 上一版指纹与结果（供「三处各变了什么」与作废说明使用） */
let lastFingerprint = ''
let lastResult: HangingResult | null = null

/** 由挂灯清单与灯样构建称重项（重量取自 computeMaterials，不另估） */
export function makeHangingItem(lantern: Lantern, desiredX: number, qty = 1): HangingItem {
  const m = computeMaterials(lantern)
  return {
    id: 'I' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3),
    lanternId: lantern.id,
    name: lantern.name,
    desiredX,
    qty: Math.max(1, Math.round(qty)),
    unitWeightG: m.totalWeightG,
    coveringName: coveringSpec(lantern.covering).name,
    coveringM2: m.coveringM2
  }
}

function fingerprint(beam: BeamConfig, strategy: DistributionStrategy, items: HangingItem[]): string {
  return JSON.stringify({
    beam,
    strategy,
    items: items
      .map((i) => [i.lanternId, i.desiredX, i.qty, i.unitWeightG, i.coveringM2])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  })
}

export function computeHanging(
  lantern: Lantern,
  beam: BeamConfig,
  strategy: DistributionStrategy,
  items: HangingItem[],
  resolveLantern?: (id: string) => Lantern | undefined
): HangingResult {
  const built = buildHangingResult(lantern, beam, strategy, items, resolveLantern, true)
  // ---- 版本与三处变化（仅用户真实输入走这里；改法模拟调 buildHangingResult 不进版本） ----
  const fp = fingerprint(beam, strategy, built.items)
  if (fp !== lastFingerprint) revisionCounter += 1
  const revision = revisionCounter
  const changes = diffResults(lastResult, {
    groups: built.groups,
    supports: built.supports,
    segments: built.segments,
    rigging: built.rigging,
    fresh: built.items,
    beam,
    strategy
  })
  const chosenLabel = strategy === 'even' ? '按挂点等分' : '按实际吊重分摊'
  const otherKey = strategy === 'even' ? 'weighted' : 'even'
  const otherLabel = otherKey === 'even' ? '按挂点等分' : '按实际吊重分摊'
  const voidedNote = lastResult
    ? `第 ${lastResult.revision} 版受力结果、已存本机的「${
        lastResult.strategy === 'even' ? '等分' : '按重分摊'
      }」挂点布置与已导出的受力表一并作废：横杆上按旧版打好的 ${
        lastResult.rigging.pointCount
      } 个挂点孔要重开，旧版分组、安全余量判定与配绳长度全部失效；当前为第 ${revision} 版（${chosenLabel}）。`
    : `首次核定（第 ${revision} 版，${chosenLabel}）。被放弃的「${otherLabel}」方案代价见下：${built.tradeoffs[otherKey].beamNote} ${built.tradeoffs[otherKey].laborNote}`

  const result = assembleResult(built, revision, changes, voidedNote)
  lastFingerprint = fp
  lastResult = result
  return result
}

function assembleResult(
  built: Omit<HangingResult, 'revision' | 'changes' | 'voidedNote'>,
  revision: number,
  changes: ChangeEntry,
  voidedNote: string
): HangingResult {
  return { ...built, revision, changes, voidedNote }
}

/**
 * 纯计算：重量取数 → 分组 → 求解 → 分段 → 装备料 → 代价对比 →（可选）改法模拟。
 * 不触碰模块级版本状态；computeHanging 与改法模拟都经此一条路，保证同口径。
 */
function buildHangingResult(
  lantern: Lantern,
  beam: BeamConfig,
  strategy: DistributionStrategy,
  items: HangingItem[],
  resolveLantern: ((id: string) => Lantern | undefined) | undefined,
  withFixes: boolean,
  insertPointX?: number
): Omit<HangingResult, 'revision' | 'changes' | 'voidedNote'> {
  const section = beamSectionSpec(beam.sectionId)
  const tier = safetyTierSpec(beam.tierId)
  const W = sectionModulus(section)
  const allowNm = allowableMomentNm(section, tier)

  // 重量不另估：逐灯按 lanternId 重新取 computeMaterials()（蒙面材料/尺寸一改重量即变）；
  // 解析不到灯样时沿用创建挂灯项时的同口径重量快照（仍来自 computeMaterials，绝不按张数另估）。
  const resolve = (id: string) => (resolveLantern ? resolveLantern(id) : id === lantern.id ? lantern : undefined)
  const fresh: HangingItem[] = items.map((it) => {
    const src = resolve(it.lanternId)
    const m = src ? computeMaterials(src) : null
    return {
      ...it,
      unitWeightG: m ? m.totalWeightG : it.unitWeightG,
      coveringName: m && src ? coveringSpec(src.covering).name : it.coveringName,
      coveringM2: m ? m.coveringM2 : it.coveringM2
    }
  })
  const loads: LoadItem[] = fresh.map((it) => ({ item: it, weightG: it.unitWeightG * Math.max(1, it.qty) }))

  const groups =
    strategy === 'even' ? groupEven(loads, beam, insertPointX) : groupWeighted(loads, beam, insertPointX)
  const solved = solve(beam, groups, section)

  const points: BeamPoint[] = solved.kps.map((p) => ({ xMm: ri(p.x), kind: p.kind, refId: p.refId }))

  const segments: BeamSegment[] = []
  const zoneOf = (x: number): BeamSegment['zone'] =>
    x < beam.leftSupportMm - 1e-6 ? 'left_overhang' : x > beam.rightSupportMm + 1e-6 ? 'right_overhang' : 'span'
  for (let i = 0; i < solved.kps.length - 1; i++) {
    const a = solved.kps[i]
    const b = solved.kps[i + 1]
    const Ma = solved.M.get(a.x) ?? 0
    const Mb = solved.M.get(b.x) ?? 0
    const Va = solved.Vleft.get(a.x) ?? 0
    let peak = Math.max(Math.abs(Ma), Math.abs(Mb))
    let peakAt: 'start' | 'end' = Math.abs(Ma) >= Math.abs(Mb) ? 'start' : 'end'
    if (solved.q > 0 && Math.abs(b.x - a.x) > 1e-9) {
      const xStar = a.x + Va / solved.q
      if (xStar > a.x + 1e-6 && xStar < b.x - 1e-6) {
        const Mstar = Ma + Va * (xStar - a.x) - (solved.q * (xStar - a.x) ** 2) / 2
        if (Math.abs(Mstar) > peak) {
          peak = Math.abs(Mstar)
          peakAt = Math.abs(xStar - a.x) <= Math.abs(b.x - xStar) ? 'start' : 'end'
        }
      }
    }
    const peakNm = nm1(peak / 1000)
    const zone = zoneOf((a.x + b.x) / 2)
    const util = allowNm > 0 ? peakNm / allowNm : Infinity
    const pass = peakNm <= allowNm + 1e-6
    const zlabel = zone === 'left_overhang' ? '左挑出端' : zone === 'right_overhang' ? '右挑出端' : '两支座间'
    segments.push({
      id: `S${i + 1}`,
      fromX: ri(a.x),
      toX: ri(b.x),
      lengthMm: ri(b.x - a.x),
      zone,
      momentStartNm: nm1(Ma / 1000),
      momentEndNm: nm1(Mb / 1000),
      momentPeakNm: peakNm,
      peakAt,
      shearN: n1(Va),
      pass,
      allowableNm: allowNm,
      utilization: Math.round(util * 1000) / 1000,
      overLabel: `${zlabel} ${ri(a.x)}–${ri(b.x)}mm 段（极值 ${peakNm.toFixed(1)}N·m，档位容许 ${allowNm.toFixed(1)}N·m）`
    })
  }

  const supports: SupportReaction[] = [
    { id: 'SA', xMm: ri(beam.leftSupportMm), reactionN: n1(solved.Ra), reactionKg: r3(solved.Ra / G) },
    { id: 'SB', xMm: ri(beam.rightSupportMm), reactionN: n1(solved.Rb), reactionKg: r3(solved.Rb / G) }
  ]

  const overSegs = segments.filter((s) => !s.pass)
  const checks: SegmentCheck[] = withFixes
    ? overSegs.map((seg) => {
        const addPoint = simulateFix(lantern, beam, strategy, fresh, seg, 'add_point', resolveLantern)
        const moveLamp = simulateFix(lantern, beam, strategy, fresh, seg, 'move_lantern', resolveLantern)
        return {
          segmentId: seg.id,
          zone: seg.zone,
          peakNm: seg.momentPeakNm,
          allowableNm: seg.allowableNm,
          utilization: seg.utilization,
          pass: false,
          fixes: [addPoint, moveLamp]
        }
      })
    : []

  // ---- 挂装备料（三处同源中的材料页口径） ----
  const ropeRawMm = groups.reduce((s, g) => s + g.ropeTotalMm, 0)
  const ropeM = r3((ropeRawMm / 1000) * (1 + CRAFT.hanging.ropeWasteRatio))
  const ringCount = groups.reduce((s, g) => s + g.rings, 0)
  const ringCountBuy = Math.ceil(ringCount * (1 + CRAFT.hanging.hardwareWasteRatio))
  const clampCount = 2
  const stiffenerCount = overSegs.length
  const hc = CRAFT.hanging
  const ropeWeightG = r1(ropeM * hc.ropeWeightGPerM)
  const ringWeightG = r1(ringCountBuy * hc.ringWeightGEach)
  const clampWeightG = r1(Math.ceil(clampCount * (1 + hc.hardwareWasteRatio)) * hc.clampWeightGEach)
  const stiffenerWeightG = r1(Math.ceil(stiffenerCount * (1 + hc.hardwareWasteRatio)) * hc.stiffenerWeightGEach)
  const rigging: RiggingMaterials = {
    pointCount: groups.length,
    ringCount,
    ropeM,
    ropeRawM: r3(ropeRawMm / 1000),
    clampCount,
    stiffenerCount,
    stiffenerSegmentIds: overSegs.map((s) => s.id),
    ropeWeightG,
    ringWeightG,
    clampWeightG,
    stiffenerWeightG,
    totalRiggingWeightG: r1(ropeWeightG + ringWeightG + clampWeightG + stiffenerWeightG),
    beamStockMm: beam.lengthMm,
    beamWeightKg: r3((section.weightGPerM * beam.lengthMm) / 1000 / 1000)
  }

  const globalPeak = segments.reduce(
    (acc, s) => (s.momentPeakNm > acc.v ? { v: s.momentPeakNm, x: s.peakAt === 'start' ? s.fromX : s.toX } : acc),
    { v: 0, x: 0 }
  )

  // ---- 两种分摊方式的代价对比（不含改法，避免递归） ----
  const tradeSelf = buildTradeoff(strategy, groups, globalPeak.v, section, tier, W)
  const otherStrategy: DistributionStrategy = strategy === 'even' ? 'weighted' : 'even'
  const otherGroups = otherStrategy === 'even' ? groupEven(loads, beam) : groupWeighted(loads, beam)
  const otherPeak = peakMomentNm(beam, otherGroups, section)
  const tradeOther = buildTradeoff(otherStrategy, otherGroups, otherPeak, section, tier, W)
  const tradeoffs = { [strategy]: tradeSelf, [otherStrategy]: tradeOther } as Record<
    DistributionStrategy,
    StrategyTradeoff
  >

  const matsRef = computeMaterials(lantern)
  const cov = coveringSpec(lantern.covering)
  return {
    generatedAt: new Date().toISOString(),
    strategy,
    beam,
    section,
    tier,
    sectionModulusMm3: Math.round(W),
    items: fresh,
    groups,
    supports,
    segments,
    points,
    checks,
    rigging,
    totalLanternKg: r3(fresh.reduce((s, i) => s + i.unitWeightG * i.qty, 0) / 1000),
    totalLoadN: n1(solved.totalLoad),
    globalPeakNm: globalPeak.v,
    globalPeakXMm: ri(globalPeak.x),
    allPass: overSegs.length === 0,
    balanceDeltaN: n1(solved.balanceDelta),
    endMomentNm: nm1(solved.endMoment / 1000),
    tradeoffs,
    weightProvenance: `每盏灯重取自备料统计 computeMaterials()：蒙面 ${matsRef.coveringM2}m²（含缝份的裁片面积）× ${cov.name}面密度 ${cov.areaWeightGPerM2}g/m² + 骨架备料 ${matsRef.frameM}m×${CRAFT.frameWeightGPerM}g/m + 扎线/胶/LED/电池/顶部五金；受力、材料页、导出三处共用单灯总重 ${matsRef.totalWeightG}g（${matsRef.totalWeightKg}kg），不按张数另估、不允许一处按面积一处按张数。`,
    unitsNote:
      '重量先按克（g）记账、F=m·g（g=9.81m/s²）换算成牛（N）参与受力，展示再折千克（kg）；长度 mm（挂点孔位取整 1mm），拉力/剪力保留 1 位小数 N，弯矩保留 1 位小数 N·m。支座反力与两端挑出端分开计算；弯矩极值只落在挂点或支座处，逐段累加与整杆平衡（反力和−总载、右端 M=0）核对。'
  }
}

/** 给定分组求全杆弯矩极值（N·m），供换路代价对比复用 */
function peakMomentNm(beam: BeamConfig, groups: HangingGroup[], section: BeamSectionSpec): number {
  const s = solve(beam, groups, section)
  let pk = 0
  for (let i = 0; i < s.kps.length - 1; i++) {
    const a = s.kps[i]
    const b = s.kps[i + 1]
    const Ma = (s.M.get(a.x) ?? 0) / 1000
    const Mb = (s.M.get(b.x) ?? 0) / 1000
    pk = Math.max(pk, Math.abs(Ma), Math.abs(Mb))
    if (s.q > 0) {
      const Va = s.Vleft.get(a.x) ?? 0
      const xs = a.x + Va / s.q
      if (xs > a.x && xs < b.x) {
        pk = Math.max(pk, Math.abs((Ma * 1000 + Va * (xs - a.x) - (s.q * (xs - a.x) ** 2) / 2) / 1000))
      }
    }
  }
  return nm1(pk)
}

/** 两条改法的模拟重算：直接调纯计算核心（withFixes=false），不再生成嵌套改法，杜绝递归 */
function simulateFix(
  lantern: Lantern,
  beam: BeamConfig,
  strategy: DistributionStrategy,
  items: HangingItem[],
  seg: BeamSegment,
  fix: 'add_point' | 'move_lantern',
  resolveLantern?: (id: string) => Lantern | undefined
): OverSegmentFix {
  const span = beam.rightSupportMm - beam.leftSupportMm
  let trialItems = items
  let insertX: number | undefined
  const evalCfg = (it2: HangingItem[], ix?: number) => {
    const r = assembleResult(
      buildHangingResult(lantern, beam, strategy, it2, resolveLantern, false, ix),
      lastResult ? lastResult.revision : 0,
      { preview: [], materials: [], exports: [] },
      '改法模拟结果（尚未采用，不改变版本；采用后旧孔位作废、整杆重算）'
    )
    return { r, util: utilizationMaxOf(r) }
  }

  if (fix === 'move_lantern') {
    // 全局贪心挪灯：每一步选「移走后全杆峰值下降最多」的一盏灯与其目标位置，
    // 逐盏挪（不增孔、不动杆），直到合格或再挪无改善。均匀满载时挪不动属物理真实。
    let cur = items
    let curUtil = utilizationMaxOf(
      assembleResult(
        buildHangingResult(lantern, beam, strategy, cur, resolveLantern, false),
        lastResult ? lastResult.revision : 0,
        { preview: [], materials: [], exports: [] },
        ''
      )
    )
    const candF = [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88]
    const candX = candF.map((f) => ri(beam.leftSupportMm + span * f))
    for (let step = 0; step < 5 && curUtil > 1; step++) {
      let best: { util: number; id: string; x: number } | null = null
      for (const it of cur) {
        for (const x of candX) {
          if (Math.abs(x - it.desiredX) < 30) continue
          const t = cur.map((i) => (i.id === it.id ? { ...i, desiredX: x } : i))
          const u = utilizationMaxOf(evalCfg0(t))
          if (!best || u < best.util) best = { util: u, id: it.id, x }
        }
      }
      if (!best || best.util >= curUtil - 0.005) break
      cur = cur.map((i) => (i.id === best!.id ? { ...i, desiredX: best!.x } : i))
      curUtil = best.util
    }
    trialItems = cur
    function evalCfg0(t: HangingItem[]) {
      return assembleResult(
        buildHangingResult(lantern, beam, strategy, t, resolveLantern, false),
        lastResult ? lastResult.revision : 0,
        { preview: [], materials: [], exports: [] },
        ''
      )
    }
  }
  if (fix === 'add_point' && seg.zone === 'span') {
    // 加一个孔：在跨内扫描孔位，取全杆峰值最低处（挑出端不适用，见下方文案）。
    // 单点能削多少算多少；若仍超，文案提示需继续加点或换更粗杆料。
    const baseUtil = utilizationMaxOf(
      assembleResult(
        buildHangingResult(lantern, beam, strategy, items, resolveLantern, false),
        lastResult ? lastResult.revision : 0,
        { preview: [], materials: [], exports: [] },
        ''
      )
    )
    let best: { util: number; x: number } | null = null
    for (let f = 0.1; f <= 0.9; f += 0.05) {
      const x = ri(beam.leftSupportMm + span * f)
      const u = evalCfg(items, x).util
      if (!best || u < best.util) best = { util: u, x }
    }
    // 加孔不应比不加更差（分组算法在个别非均匀工况可能使峰值略升）：若更差则视为该孔未起作用
    if (best && best.util < baseUtil - 0.002) insertX = best.x
  }
  const basePoints = groupsCountHint(items)
  const simulated = evalCfg(trialItems, insertX).r
  const simUtil = utilizationMaxOf(simulated)
  const pass = simulated.allPass
  const isOverhang = seg.zone !== 'span'
  const cost =
    fix === 'add_point'
      ? isOverhang
        ? `该段是${seg.zone === 'left_overhang' ? '左' : '右'}挑出端，加挂点没有第二支座支撑、削不掉挑出端弯矩 —— 此改法对挑出端不适用。应改用「把灯挪开」（移进两支座之间）或把${seg.zone === 'left_overhang' ? '左' : '右'}支座向外移（杆料/孔位代价另计）。`
        : `在 ${ri(seg.fromX)}–${ri(seg.toX)}mm 段内新增 1 个挂点孔（共 ${simulated.rigging.pointCount} 孔）：多 1 套吊环、配绳约 ${simulated.rigging.ropeM.toFixed(2)}m，横杆现场多钻 1 孔、多挂 1 点（约 ${CRAFT.hanging.installMinutesPerPointWeighted} 分钟/点），杆料与加固件可不加。`
      : `不开新孔、不加杆料：把该段最重的一盏灯挪向${isOverhang ? '两支座之间' : '相邻弯矩较低的四分点'}（孔位仍用原有 ${basePoints} 个），只需重新排位、改一处挂绳长度（约 ${CRAFT.hanging.ropeTieMinutesPerPointExtra} 分钟重新系绳）；灯位视觉不再等距。`
  const tradeoff =
    fix === 'add_point'
      ? `取舍：弯矩削峰最直接（模拟后最大利用率 ${(simUtil * 100).toFixed(0)}%，${pass ? '全杆合格' : '仍有超限段'}），代价是横杆多一个不可恢复的孔、多一套吊环绳索与现场工时；适合灯位本来就要加密的情形。`
      : `取舍：不动杆、不增料、不增孔，靠挪灯削峰（模拟后最大利用率 ${(simUtil * 100).toFixed(0)}%，${pass ? '全杆合格' : '仍有超限段'}）；代价是灯串疏密不匀、观感让一步，且挪灯改变了配绳长度，旧配绳表作废。`
  return {
    kind: fix,
    title: fix === 'add_point' ? '改法一：加挂点（该段加密一孔）' : '改法二：把灯挪开（重排灯位）',
    cost,
    tradeoff,
    simulated,
    simulatedPeakUtil: simUtil,
    simulatedPass: pass
  }
}

/** 当前方案的挂点数（改法文案用，不做力学重算） */
function groupsCountHint(items: HangingItem[]): number {
  const totalQty = items.reduce((s, i) => s + Math.max(1, i.qty), 0)
  if (!totalQty) return 0
  return Math.min(totalQty, Math.max(3, Math.ceil(totalQty / 2)))
}


// ---------------------------------------------------------------- 代价对比

function buildTradeoff(
  strategy: DistributionStrategy,
  groups: HangingGroup[],
  peakNm: number,
  section: BeamSectionSpec,
  tier: SafetyTierSpec,
  W: number
): StrategyTradeoff {
  const ropeSpecKinds = new Set(groups.map((g) => `${g.legs}×${g.ropePerLegMm}`)).size
  const perPointMin =
    strategy === 'even' ? CRAFT.hanging.installMinutesPerPointEven : CRAFT.hanging.installMinutesPerPointWeighted
  const laborMinutes = groups.length * perPointMin + (strategy === 'weighted' ? groups.length * CRAFT.hanging.ropeTieMinutesPerPointExtra : 0)
  const reqW = (peakNm * 1000 * tier.factor) / section.allowableBendingMPa
  const enough = W + 1e-6 >= reqW
  // 需要的线密度：按 W 与圆管/矩形的关系反推不直观，改用「峰值弯矩比例」折算所需线密度（同材料截面）
  const ratio = W > 0 ? reqW / W : 1
  const neededGPerM = section.weightGPerM * Math.max(1, ratio ** 0.5) // 截面模量约随尺度²~³，用 0.5 次幂保守折算
  const delta = Math.round(neededGPerM - section.weightGPerM)
  const beamNote = enough
    ? `现有「${section.name}」截面模量 ${Math.round(W)}mm³ ≥ 所需 ${Math.round(
        reqW
      )}mm³，杆料不动；若改走另一方案峰值弯矩不同，可让出/需补杆料见对比。`
    : `现有截面模量 ${Math.round(W)}mm³ 小于所需 ${Math.round(reqW)}mm³，需换大约 +${delta}g/m 的更粗杆料（或接受加固件）。`
  return {
    strategy,
    label: strategy === 'even' ? '按挂点等分' : '按实际吊重分摊',
    pointCount: groups.length,
    ropeSpecKinds,
    laborMinutes,
    laborNote:
      strategy === 'even'
        ? `孔位等距、同一套配绳，现场 ${groups.length} 点 × ${perPointMin} 分钟/点 ≈ ${laborMinutes} 分钟，好挂好查`
        : `每点吊法与绳索逐点交代、不等距打孔，${groups.length} 点 × ${perPointMin} 分钟/点 + 逐点系绳 ${
            groups.length * CRAFT.hanging.ropeTieMinutesPerPointExtra
          } 分钟 ≈ ${laborMinutes} 分钟，现场更费工`,
    peakNm,
    requiredSectionModulusMm3: Math.round(reqW),
    actualSectionModulusMm3: Math.round(W),
    beamEnough: enough,
    beamStockDeltaGPerM: delta,
    beamNote,
    pass: enough
  }
}

// ---------------------------------------------------------------- 三处变化对比

function diffResults(
  prev: HangingResult | null,
  next: {
    groups: HangingGroup[]
    supports: SupportReaction[]
    segments: BeamSegment[]
    rigging: RiggingMaterials
    fresh: HangingItem[]
    beam: BeamConfig
    strategy: DistributionStrategy
  }
): ChangeEntry {
  if (!prev) {
    return {
      preview: [
        `首次布置：${next.groups.length} 个挂点 ${next.groups.map((g) => `${g.id}@${g.xMm}mm/${g.ropeTensionN.toFixed(1)}N`).join('、')}；支座反力 ${next.supports
          .map((s) => `${s.id}=${s.reactionN.toFixed(1)}N`)
          .join('、')}`
      ],
      materials: [
        `首次备料：挂绳 ${next.rigging.ropeM}m、吊环 ${next.rigging.ringCount} 只、固定夹 ${next.rigging.clampCount} 副、加固件 ${next.rigging.stiffenerCount} 件`
      ],
      exports: ['受力表与挂装备料单首次导出：挂点行、段弯矩行、挂绳/吊环/加固件行全部为新增']
    }
  }
  const preview: string[] = []
  const materials: string[] = []
  const exports: string[] = []

  const pg = new Map(prev.groups.map((g) => [g.id, g]))
  const ng = new Map(next.groups.map((g) => [g.id, g]))
  for (const [id, g] of ng) {
    const old = pg.get(id)
    if (!old) preview.push(`挂点 ${id} 新增：@${g.xMm}mm、拉力 ${g.ropeTensionN.toFixed(1)}N、${g.lanternCount} 盏`)
    else if (old.xMm !== g.xMm || Math.abs(old.ropeTensionN - g.ropeTensionN) > 0.05)
      preview.push(
        `挂点 ${id} 变动：孔位 ${old.xMm}→${g.xMm}mm、拉力 ${old.ropeTensionN.toFixed(1)}→${g.ropeTensionN.toFixed(1)}N`
      )
  }
  for (const [id] of pg) if (!ng.has(id)) preview.push(`挂点 ${id} 移除（旧孔位作废重开）`)
  next.supports.forEach((s, i) => {
    const o = prev.supports[i]
    if (o && Math.abs(o.reactionN - s.reactionN) > 0.05)
      preview.push(`支座 ${s.id} 反力 ${o.reactionN.toFixed(1)}→${s.reactionN.toFixed(1)}N`)
  })

  const pr = prev.rigging
  const nr = next.rigging
  const row = (label: string, ov: number, nv: number, unit: string, arr: string[]) => {
    if (Math.abs(ov - nv) > 1e-9) arr.push(`${label}：${ov}${unit} → ${nv}${unit}`)
  }
  row('挂绳米数', pr.ropeM, nr.ropeM, 'm', materials)
  row('吊环', pr.ringCount, nr.ringCount, ' 只', materials)
  row('固定夹', pr.clampCount, nr.clampCount, ' 副', materials)
  row('加固件', pr.stiffenerCount, nr.stiffenerCount, ' 件', materials)
  if (materials.length === 0) materials.push('吊挂件项与米数无变化')

  const ps = new Map(prev.segments.map((s) => [s.id, s]))
  next.segments.forEach((s) => {
    const o = ps.get(s.id)
    if (o && Math.abs(o.momentPeakNm - s.momentPeakNm) > 0.05)
      exports.push(`受力表段 ${s.id}（${s.fromX}-${s.toX}mm）弯矩 ${o.momentPeakNm.toFixed(1)}→${s.momentPeakNm.toFixed(1)}N·m`)
    if (o && o.pass !== s.pass)
      exports.push(`受力表段 ${s.id} 安全判定 ${o.pass ? '合格' : '超限'} → ${s.pass ? '合格' : '超限'}`)
  })
  exports.push(
    `备料单挂装行：挂绳 ${pr.ropeM}→${nr.ropeM}m、吊环 ${pr.ringCount}→${nr.ringCount} 只、加固件 ${pr.stiffenerCount}→${nr.stiffenerCount} 件`
  )
  if (prev.strategy !== next.strategy)
    exports.unshift(`分摊方式换路：${prev.strategy === 'even' ? '等分' : '按重'}→${next.strategy === 'even' ? '等分' : '按重'}，旧版整表作废重出`)
  return { preview, materials, exports }
}
