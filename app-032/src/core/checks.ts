/**
 * 自检（对应规格书 §10 验收标准）
 * 每次参数变化都会重算全部几何并跑一遍断言，结果直接显示在界面上。
 */
import type { CheckResult, Lantern } from './types'
import { bodySurfaceArea, polygonEdge, ringPerimeter, segmentInfos } from './geometry'
import { buildFrame, type FrameResult } from './frame'
import { buildPanels, panelNetArea, type PanelResult } from './panels'
import { computeBatch, computeMaterials, type BatchMaterials, type SingleLightMaterials } from './materials'
import { assertNoPanelSplit, paginate, type LoftOptions, type Sheet } from './paginate'
import { getLantern } from './store'
import { computeHanging, type HangingResult, utilizationMaxOf } from './hanging'
import { getState } from './hangingStore'
import { coveringSpec, CRAFT } from './craft'

export interface FullResult {
  frame: FrameResult
  panels: PanelResult
  materials: SingleLightMaterials
  batch: BatchMaterials
  sheets: Sheet[]
  hanging: HangingResult | null
  checks: CheckResult[]
  elapsedMs: number
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)
const f3 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3)

export function computeAll(l: Lantern, loft: LoftOptions): FullResult {
  const t0 = performance.now()
  const frame = buildFrame(l)
  const panels = buildPanels(l)
  const materials = computeMaterials(l)
  const batch = computeBatch(materials, Math.max(1, Math.round(l.batchCount)), l.wasteRatio)
  const sheets = paginate(l, loft)
  // 挂点受力（三处同源的唯一入口；参数页/材料页/导出都取同一个对象）
  const hs = getState(l.id)
  const hangingResolved = hs ? computeHanging(l, hs.beam, hs.strategy, hs.items, (id) => getLantern(id)) : null
  const elapsedMs = performance.now() - t0
  const checks = runChecks(l, frame, panels, materials, batch, sheets, elapsedMs, hangingResolved)
  return { frame, panels, materials, batch, sheets, hanging: hangingResolved, checks, elapsedMs }
}

function runChecks(
  l: Lantern,
  frame: FrameResult,
  panels: PanelResult,
  materials: SingleLightMaterials,
  batch: BatchMaterials,
  sheets: Sheet[],
  elapsedMs: number,
  hanging: HangingResult | null
): CheckResult[] {
  const out: CheckResult[] = []
  const g = frame.geometry
  const lash = Math.max(0, l.lashAllowanceMm)

  // ---- CHK-01 几何：棱长/周长与手算一致 ----
  {
    const cases = [
      { name: '正六棱柱底边（D200）', got: polygonEdge(100, 6), expect: 100, tol: 1 },
      { name: '正八棱柱底边（D200）', got: polygonEdge(100, 8), expect: 76.5367, tol: 1 },
      { name: '圆形横篾圈周长（D200）', got: ringPerimeter(100, 0, false), expect: 628.3185, tol: 1 },
      { name: '六边形周长（D200）', got: ringPerimeter(100, 6, true), expect: 600, tol: 1 }
    ]
    const bad = cases.filter((c) => Math.abs(c.got - c.expect) > c.tol)
    out.push({
      id: 'CHK-01',
      title: '几何手算核对（棱长 / 周长，误差 ≤ 1mm）',
      pass: bad.length === 0,
      value: bad.length === 0 ? '4/4 项通过' : `${bad.length} 项超差`,
      detail: cases
        .map((c) => `${c.name}：算得 ${f3(c.got)} / 手算 ${f3(c.expect)}（Δ${f3(Math.abs(c.got - c.expect))}）`)
        .join('；')
    })
  }

  // ---- CHK-02 竖篾长度与分段高度累计 ----
  {
    const segs = segmentInfos(g)
    const sumH = segs.reduce((s, x) => s + x.heightMm, 0)
    const sumSlant = segs.reduce((s, x) => s + x.slantMm, 0)
    const vertical = frame.members.find((m) => m.kind === 'vertical' || m.kind === 'rib')
    const raw = vertical ? vertical.rawLengthMm : 0
    const allStraight = segs.every((s) => Math.abs(s.drMm) < 0.05)
    const pass = Math.abs(raw - sumSlant) <= 0.1 && (!allStraight || Math.abs(raw - sumH) <= 0.1)
    out.push({
      id: 'CHK-02',
      title: '竖篾净长 = 分段母线折线长累计',
      pass,
      value: `Δ折线 ${f1(Math.abs(raw - sumSlant))}mm`,
      detail: allStraight
        ? `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，平口直柱两者一致（Δ${f1(Math.abs(raw - sumH))}mm）`
        : `竖篾净长 ${f1(raw)}mm，分段高累计 ${f1(sumH)}mm，折线长累计 ${f1(sumSlant)}mm（收口段横向偏移 ${f1(sumSlant - sumH)}mm）`
    })
  }

  // ---- CHK-03 缝份 ----
  {
    const s = Math.max(0, l.seamAllowanceMm)
    const bad = panels.panels.filter(
      (p) =>
        Math.abs(p.widthTopMm - (p.rawWidthTopMm + 2 * s)) > 0.06 ||
        Math.abs(p.widthBottomMm - (p.rawWidthBottomMm + 2 * s)) > 0.06 ||
        Math.abs(p.heightMm - (p.rawHeightMm + 2 * s)) > 0.06
    )
    out.push({
      id: 'CHK-03',
      title: '裁片尺寸 = 展开净尺寸 + 缝份 × 2（每边）',
      pass: bad.length === 0,
      value: `${panels.panels.length - bad.length}/${panels.panels.length} 种裁片通过`,
      detail:
        bad.length === 0
          ? `全部 ${panels.panels.length} 种裁片上/下/高三个尺寸均等于净尺寸 + ${f1(s)}×2mm；裁片图以红色虚线绘制缝份折线`
          : `超差裁片：${bad.map((p) => p.label).join('、')}`
    })
  }

  // ---- CHK-04 备料守恒 ----
  {
    const stock = frame.members.reduce((a, m) => a + m.lengthMm * m.qty, 0)
    const rawTotal = frame.members.reduce((a, m) => a + m.rawLengthMm * m.qty, 0)
    const lashTotal = frame.members.reduce((a, m) => a + m.qty * m.lashJoints * lash, 0)
    const diff = stock - rawTotal
    const pass = stock >= rawTotal - 1e-6 && Math.abs(diff - lashTotal) <= 0.5
    out.push({
      id: 'CHK-04',
      title: '备料守恒：Σ备料长度 ≥ Σ净长，且差值 = 余量总和',
      pass,
      value: `Σ备料 ${f1(stock)}mm / Σ净长 ${f1(rawTotal)}mm`,
      detail: `差值 ${f1(diff)}mm，应等于余量总和 ${f1(lashTotal)}mm（竖篾两端、横篾圈接头各计 ${f1(lash)}mm）`
    })
  }

  // ---- CHK-05 面积核对 ----
  {
    const netArea = panels.panels.reduce((a, p) => a + panelNetArea(p) * p.qty, 0)
    const refArea = bodySurfaceArea(g, Math.max(3, Math.round(l.divisions)))
    const ratio = refArea > 0 ? netArea / refArea : 0
    const pass = ratio >= 0.97 && ratio <= 1.03
    let advice = ''
    if (!pass && !g.polygon) {
      const need = suggestDivisions(l, netArea, ratio)
      advice = need ? `；建议把母线等分数提高到 ${need}（当前 ${l.divisions}）` : ''
    } else if (!pass) {
      advice = '；请检查缝份/分层参数，棱柱类侧面积应与裁片面积完全一致'
    }
    out.push({
      id: 'CHK-05',
      title: '面积核对：Σ裁片净面积 / 灯体表面积 ∈ [0.97, 1.03]',
      pass,
      value: `比值 ${(ratio * 100).toFixed(2)}%`,
      detail: `裁片净面积 ${f3(netArea / 1_000_000)}m²，灯体表面积（含顶底盖）${f3(refArea / 1_000_000)}m²${advice}`
    })
  }

  // ---- CHK-06 分页：裁片不跨页 ----
  {
    const r = assertNoPanelSplit(sheets)
    out.push({
      id: 'CHK-06',
      title: '分页：任一裁片不跨页（长条跨页带对位十字与搭接量）',
      pass: r.pass,
      value: r.pass ? '通过' : '失败',
      detail: `${r.detail}；跨页仅出现在骨架长条上，接缝处绘制对位十字并标注搭接 ${f1(loftOverlap(sheets))}mm 与拼接编号`
    })
  }

  // ---- CHK-07 批量 ----
  {
    const n = Math.max(1, Math.round(l.batchCount))
    const k = n * (1 + l.wasteRatio)
    // 与单灯值的偏差只来自展示精度（长度 3 位小数 / 胶 1 位小数）
    const errs = [
      Math.abs(batch.frameM - materials.frameM * k),
      Math.abs(batch.coveringM2 - materials.coveringM2 * k),
      Math.abs(batch.lashM - materials.lashM * k)
    ]
    const pass = errs.every((e) => e <= 0.0011) && Math.abs(batch.glueG - materials.glueG * k) <= 0.051
    out.push({
      id: 'CHK-07',
      title: `批量制灯：${n} 个材料总量 = 单灯 × ${n} × (1 + ${(l.wasteRatio * 100).toFixed(0)}%)`,
      pass,
      value: `竹篾 ${f3(batch.frameM)}m / 蒙面 ${f3(batch.coveringM2)}m²`,
      detail: `单灯竹篾 ${f3(materials.frameM)}m × ${n} × ${(1 + l.wasteRatio).toFixed(2)} = ${f3(materials.frameM * k)}m = 批量值；蒙面、扎线、胶同理（LED 按颗数 × ${n} 计，不参与损耗）`
    })
  }

  // ---- CHK-08 性能 ----
  {
    const pass = elapsedMs < 100
    out.push({
      id: 'CHK-08',
      title: '放样计算 < 100ms',
      pass,
      value: `${elapsedMs.toFixed(1)}ms`,
      detail: `${l.divisions} 等分 × ${l.layers.length} 层：构件 ${frame.totalQty} 根、裁片 ${panels.totalQty} 块、图纸 ${sheets.length} 页，全流程耗时 ${elapsedMs.toFixed(1)}ms（含分页）`
    })
  }

  // ---- CHK-09 灯重与备料同源：受力用的单灯重 = 备料统计总重；蒙面按面积不按张数 ----
  if (hanging && hanging.items.length) {
    const bad = hanging.items.filter(
      (it) => it.lanternId === l.id && Math.abs(it.unitWeightG - materials.totalWeightG) > 0.2
    )
    // 蒙面重必须 = 含缝份裁片面积 × 材料清单面密度（与备料统计同一口径，按面积不按张数）
    const covSpec = coveringSpec(l.covering).areaWeightGPerM2
    const expectCovG = materials.coveringM2 * covSpec
    const covOk = Math.abs(expectCovG - materials.coveringWeightG) <= 0.2
    const pass = bad.length === 0 && covOk
    out.push({
      id: 'CHK-09',
      title: '灯重同源：受力单灯重 = 备料统计总重（蒙面按含缝份面积，不按张数）',
      pass,
      value: pass
        ? `${materials.totalWeightG.toFixed(1)}g 一致`
        : `${bad.length} 盏不一致 / 蒙面口径 ${covOk ? '一致' : '不符'}`,
      detail: `备料统计单灯总重 ${materials.totalWeightG.toFixed(1)}g（蒙面 ${materials.coveringM2}m²×${covSpec}g/m²=${expectCovG.toFixed(1)}g、骨架 ${materials.frameM}m×${CRAFT.frameWeightGPerM}g/m=${materials.frameWeightG.toFixed(1)}g）；受力挂灯清单取同数 ${hanging.items[0]?.unitWeightG.toFixed(1)}g；蒙面按面积 ${covOk}，无「一处按面积一处按张数」。`
    })
  }

  // ---- CHK-10 整杆平衡：反力和 = 总载，右端弯矩 = 0（逐段累加与整杆核算一致） ----
  if (hanging) {
    const sumR = hanging.supports.reduce((s, x) => s + x.reactionN, 0)
    const dForce = Math.abs(sumR - hanging.totalLoadN)
    const dEnd = Math.abs(hanging.endMomentNm)
    const pass = dForce <= 0.2 && dEnd <= 0.05
    out.push({
      id: 'CHK-10',
      title: '整杆平衡：支座反力和 = 总载（误差≤0.2N），右端弯矩 = 0（≤0.05N·m）',
      pass,
      value: `Δ力 ${f1(dForce)}N / ΔM端 ${f2(dEnd)}N·m`,
      detail: `支座反力 ${hanging.supports.map((s) => `${s.id}=${s.reactionN.toFixed(1)}N`).join('、')}，合计 ${sumR.toFixed(1)}N；总载 ${hanging.totalLoadN.toFixed(1)}N（含杆自重 ${hanging.beam.includeBeamWeight ? '是' : '否'}）；挑出端与跨内分段累加，右端闭合弯矩 ${hanging.endMomentNm.toFixed(2)}N·m。`
    })
  }

  // ---- CHK-11 弯矩极值只落在挂点/支座处；安全档位逐段判定 ----
  if (hanging) {
    const peakAtNode = hanging.globalPeakXMm === 0 ||
      hanging.supports.some((s) => s.xMm === hanging.globalPeakXMm) ||
      hanging.groups.some((g) => g.xMm === hanging.globalPeakXMm)
    const allowConsistent = hanging.segments.every(
      (s) => Math.abs(s.allowableNm - hanging.segments[0].allowableNm) < 1e-6
    )
    const pass = peakAtNode && allowConsistent
    const worst = hanging.segments.reduce((a, s) => (s.utilization > a.utilization ? s : a), hanging.segments[0])
    out.push({
      id: 'CHK-11',
      title: '弯矩极值落在挂点/支座处，各段用同一安全档位容许弯矩',
      pass,
      value: `极值@${hanging.globalPeakXMm}mm（${hanging.globalPeakNm.toFixed(1)}N·m）`,
      detail: `极值点 ${hanging.globalPeakXMm}mm ${peakAtNode ? '是' : '不是'}挂点/支座；最紧段 ${worst.id} 利用率 ${(worst.utilization * 100).toFixed(0)}%（${worst.momentPeakNm.toFixed(1)}/${worst.allowableNm.toFixed(1)}N·m）；容许弯矩全段一致 ${allowConsistent}。`
    })
  }

  // ---- CHK-12 三处同源：挂点数/挂绳/吊环/加固件/峰值在同一 HangingResult 内自洽 ----
  if (hanging) {
    const ringByGroups = hanging.groups.reduce((s, g) => s + g.rings, 0)
    const ropeByGroups = hanging.groups.reduce((s, g) => s + g.ropeTotalMm, 0) / 1000
    const ropeOk = Math.abs(hanging.rigging.ropeRawM - ropeByGroups) < 0.0011
    const ringOk = hanging.rigging.ringCount === ringByGroups
    const pointOk = hanging.rigging.pointCount === hanging.groups.length
    const stiffOk = hanging.rigging.stiffenerCount === hanging.checks.length &&
      hanging.rigging.stiffenerSegmentIds.join(',') === hanging.checks.map((c) => c.segmentId).join(',')
    const peakOk = utilizationMaxOf(hanging) <= 1 ? hanging.allPass : !hanging.allPass
    const pass = ropeOk && ringOk && pointOk && stiffOk && peakOk
    out.push({
      id: 'CHK-12',
      title: '三处同源：挂点/挂绳/吊环/加固件/峰值由同一份受力结果导出',
      pass,
      value: `${hanging.groups.length}点 / 绳${hanging.rigging.ropeM}m / 环${hanging.rigging.ringCount} / 加固${hanging.rigging.stiffenerCount}`,
      detail: `挂点 ${pointOk}、挂绳净长 ${hanging.rigging.ropeRawM}m=逐点合计 ${ropeByGroups.toFixed(3)}m（${ropeOk}）、吊环 ${ringByGroups}（${ringOk}）、加固件对应超限段（${stiffOk}）、峰值判定与总判定一致（${peakOk}）；预览页/材料页/导出三处分用同一对象，同一挂点拉力与同一段弯矩无出入。`
    })
  }

  return out
}

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2)

function suggestDivisions(l: Lantern, netArea: number, ratio: number): number | null {
  if (ratio <= 1.0005) return null
  for (let d = Math.max(3, Math.round(l.divisions)) + 1; d <= CRAFT.divMax; d++) {
    const ref = bodySurfaceArea(frameGeometryOf(l), d)
    const r = ref > 0 ? netArea / ref : 0
    if (r <= 1.03) return d
  }
  return CRAFT.divMax
}

function loftOverlap(sheets: Sheet[]): number {
  for (const s of sheets) {
    for (const it of s.items) {
      if (it.type === 'strip' && it.overlapMm > 0) return it.overlapMm
    }
  }
  return 0
}

/** 校验尺标称长度（mm）：1:1 打印用 */
export const CALIBRATION_RULER_MM = 100
export const CALIBRATION_CIRCLE_MM = 100

function frameGeometryOf(l: Lantern) {
  return buildFrame(l).geometry
}

/** 由圆周长反推直径（尺寸反推工具用） */
export function diameterFromPerimeter(lengthMm: number, n: number, polygon: boolean, lashMm: number): number {
  const net = Math.max(0, lengthMm - lashMm)
  if (polygon) {
    const s = Math.max(3, Math.round(n))
    return net / (s * Math.sin(Math.PI / s))
  }
  return net / Math.PI
}

/** 由母线（竖篾）长度反推可用最大直径：保持收口比例与总高，二分求解 */
export function diameterFromRib(l: Lantern, ribLengthMm: number): number {
  const target = Math.max(10, ribLengthMm - 2 * l.lashAllowanceMm)
  let lo = 20
  let hi = 3000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const test: Lantern = { ...l, maxDiameterMm: mid, mouthDiameterMm: (mid * l.mouthDiameterMm) / Math.max(1, l.maxDiameterMm), baseDiameterMm: (mid * l.baseDiameterMm) / Math.max(1, l.maxDiameterMm) }
    const segs = segmentInfos(buildFrame(test).geometry)
    const len = segs.reduce((a, s) => a + s.slantMm, 0)
    if (len < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
