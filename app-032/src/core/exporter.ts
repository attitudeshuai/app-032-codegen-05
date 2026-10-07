/** 导出：构件清单 / 裁片清单 / 备料单（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import { coveringSpec } from './craft'
import type { HangingResult } from './hanging'

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: (string | number)[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function membersCsv(l: Lantern, members: FrameMember[]): string {
  const rows: (string | number)[][] = [
    [`花灯构件清单 · ${l.name}`],
    [`最大直径 ${l.maxDiameterMm}mm / 总高 ${l.totalHeightMm}mm / 绑扎余量 每端 ${l.lashAllowanceMm}mm / 生成 ${new Date().toLocaleString()}`],
    [],
    ['构件名称', '类别', '分组', '净长(mm)', '截取长度(mm,含余量)', '余量处数', '数量', '总截取长度(mm)', '弯曲半径(mm)', '折角(°)', '备注']
  ]
  for (const m of members) {
    rows.push([
      m.label,
      kindName(m.kind),
      m.group,
      m.rawLengthMm.toFixed(1),
      m.lengthMm.toFixed(1),
      m.lashJoints,
      m.qty,
      (m.lengthMm * m.qty).toFixed(1),
      m.bendRadiusMm ? m.bendRadiusMm.toFixed(1) : '—',
      m.bendAngleDeg ? m.bendAngleDeg.toFixed(1) : '—',
      m.note || ''
    ])
  }
  const stock = members.reduce((s, m) => s + m.lengthMm * m.qty, 0)
  const raw = members.reduce((s, m) => s + m.rawLengthMm * m.qty, 0)
  rows.push([])
  rows.push(['合计', '', '', raw.toFixed(1), '', '', members.reduce((s, m) => s + m.qty, 0), stock.toFixed(1), '', '', `备料 ${(stock / 1000).toFixed(3)}m`])
  return toCsv(rows)
}

export function panelsCsv(l: Lantern, panels: Panel[]): string {
  const rows: (string | number)[][] = [
    [`蒙面裁片清单 · ${l.name}`],
    [`蒙面 ${coveringSpec(l.covering).name} / 缝份 每边 ${l.seamAllowanceMm}mm（已含在裁片尺寸内）/ 生成 ${new Date().toLocaleString()}`],
    [],
    ['裁片编号', '名称', '形状', '净上宽(mm)', '净下宽(mm)', '净高(mm)', '裁切上宽(mm)', '裁切下宽(mm)', '裁切高(mm)', '半径/对边(mm)', '数量', '对位标记数']
  ]
  for (const p of panels) {
    rows.push([
      p.id,
      p.label,
      shapeName(p.shape),
      p.rawWidthTopMm.toFixed(1),
      p.rawWidthBottomMm.toFixed(1),
      p.rawHeightMm.toFixed(1),
      p.widthTopMm.toFixed(1),
      p.widthBottomMm.toFixed(1),
      p.heightMm.toFixed(1),
      p.radiusMm ? p.radiusMm.toFixed(1) : '—',
      p.qty,
      p.marksMm.length
    ])
  }
  return toCsv(rows)
}

export function materialsCsv(
  l: Lantern,
  single: SingleLightMaterials,
  batch: BatchMaterials
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g`],
    [],
    ['项目', '单灯用量', '单位', `批量 ${batch.count} 个（含 ${(batch.wasteRatio * 100).toFixed(0)}% 损耗）`],
    ['竹篾/铁丝（含绑扎余量）', single.frameM.toFixed(3), 'm', batch.frameM.toFixed(3)],
    ['竹篾构件净长', single.frameRawM.toFixed(3), 'm', batch.frameRawM.toFixed(3)],
    [`蒙面（${cov.name}，含缝份）`, single.coveringM2.toFixed(3), 'm²', batch.coveringM2.toFixed(3)],
    ['蒙面净面积（不含缝份）', single.coveringNetM2.toFixed(3), 'm²', batch.coveringNetM2.toFixed(3)],
    ['扎线', single.lashM.toFixed(3), 'm', batch.lashM.toFixed(3)],
    ['胶', single.glueG.toFixed(1), 'g', batch.glueG.toFixed(1)],
    ['LED 灯珠建议', single.ledCount, '颗', batch.ledCount],
    [],
    ['—— 单灯重量分项（与受力核定同源：蒙面按含缝份裁片面积、骨架按备料总长）——'],
    ['骨架重（备料总长×线密度）', single.frameWeightG.toFixed(1), 'g', batch.frameWeightG.toFixed(1)],
    [`蒙面重（裁片面积×${cov.name}面密度）`, single.coveringWeightG.toFixed(1), 'g', batch.coveringWeightG.toFixed(1)],
    ['扎线重', single.lashWeightG.toFixed(1), 'g', batch.lashWeightG.toFixed(1)],
    ['胶重', single.glueWeightG.toFixed(1), 'g', batch.glueWeightG.toFixed(1)],
    ['LED 灯珠重', single.ledWeightG.toFixed(1), 'g', batch.ledWeightG.toFixed(1)],
    ['电池重', single.batteryWeightG.toFixed(1), 'g', batch.batteryWeightG.toFixed(1)],
    ['顶部吊挂五金重', single.hardwareWeightG.toFixed(1), 'g', batch.hardwareWeightG.toFixed(1)],
    ['单灯总重（受力只取此数）', single.totalWeightG.toFixed(1), 'g', ''],
    ['挂灯总重', '', '', batch.totalWeightG.toFixed(1)],
    [],
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)]
  ]
  return toCsv(rows)
}

/** 受力表（挂点拉力 / 支座反力 / 每段弯矩 / 安全判定）——与预览页、材料页同一份 HangingResult */
export function forceTableCsv(l: Lantern, r: HangingResult): string {
  const rows: (string | number)[][] = [
    [`横杆受力表（第 ${r.revision} 版）· ${l.name}`],
    [
      `生成 ${new Date(r.generatedAt).toLocaleString()} / 方案「${r.strategy === 'even' ? '按挂点等分' : '按实际吊重分摊'}」/ 杆 ${r.beam.lengthMm}mm / 支座 ${r.beam.leftSupportMm}-${r.beam.rightSupportMm}mm / ${r.section.name} / 安全档「${r.tier.name}」×${r.tier.factor}`
    ],
    [`单位口径：${r.unitsNote}`],
    [`重量出处：${r.weightProvenance}`],
    [r.voidedNote],
    [],
    ['一、挂点拉力与配绳'],
    ['挂点', '孔位(mm)', '灯数(盏)', '挂重(kg)', '荷载(N)', '单绳拉力(N)', '股数', '单绳长(mm)', '配绳总长(mm)', '吊环数', '吊法']
  ]
  for (const g of r.groups) {
    rows.push([
      g.id, g.xMm, g.lanternCount, g.weightKg, g.loadN.toFixed(1), g.ropeTensionN.toFixed(1),
      g.legs, g.ropePerLegMm, g.ropeTotalMm, g.rings, g.riggingNote
    ])
  }
  rows.push([])
  rows.push(['二、支座反力（与挑出端分开算）'])
  rows.push(['支座', '位置(mm)', '反力(N)', '折合(kg)'])
  for (const s of r.supports) rows.push([s.id, s.xMm, s.reactionN.toFixed(1), s.reactionKg.toFixed(2)])
  rows.push([])
  rows.push(['整杆平衡核对：反力和−总载(N)', r.balanceDeltaN.toFixed(1), '右端弯矩(N·m)', r.endMomentNm.toFixed(1), '总载(N)', r.totalLoadN.toFixed(1)])
  rows.push([])
  rows.push(['三、每段弯矩与安全档位（极值落在挂点/支座处）'])
  rows.push(['段', '起点(mm)', '终点(mm)', '段长(mm)', '区间', '端弯矩起(N·m)', '端弯矩止(N·m)', '峰值(N·m)', '容许(N·m)', '利用率', '剪力(N)', '判定'])
  for (const s of r.segments) {
    rows.push([
      s.id, s.fromX, s.toX, s.lengthMm,
      s.zone === 'left_overhang' ? '左挑出端' : s.zone === 'right_overhang' ? '右挑出端' : '跨内',
      s.momentStartNm.toFixed(1), s.momentEndNm.toFixed(1), s.momentPeakNm.toFixed(1),
      s.allowableNm.toFixed(1), (s.utilization * 100).toFixed(0) + '%', s.shearN.toFixed(1),
      s.pass ? '合格' : '超档'
    ])
  }
  rows.push([])
  rows.push(['全杆峰值弯矩(N·m)', r.globalPeakNm.toFixed(1), '位置(mm)', r.globalPeakXMm, '结论', r.allPass ? '全杆合格' : `有 ${r.checks.length} 段超档`])
  if (r.checks.length) {
    rows.push([])
    rows.push(['四、超档段与两条改法'])
    for (const c of r.checks) {
      rows.push([`段 ${c.segmentId}`, `峰值 ${c.peakNm.toFixed(1)}＞容许 ${c.allowableNm.toFixed(1)}（${(c.utilization * 100).toFixed(0)}%）`])
      for (const f of c.fixes) rows.push([f.title, f.cost, f.tradeoff, f.simulatedPass ? '模拟后合格' : '模拟后仍超'])
    }
  }
  return toCsv(rows)
}

/** 挂装备料单（挂绳/吊环/固定夹/加固件/横杆）——与材料页同一份 HangingResult.rigging */
export function riggingCsv(l: Lantern, r: HangingResult): string {
  const rg = r.rigging
  const rows: (string | number)[][] = [
    [`挂装备料单（第 ${r.revision} 版）· ${l.name}`],
    [`生成 ${new Date(r.generatedAt).toLocaleString()} / 方案「${r.strategy === 'even' ? '按挂点等分' : '按实际吊重分摊'}」/ 与受力表、材料页、预览页同一份结果`],
    [r.voidedNote],
    [],
    ['项目', '净用量', '含损耗备料', '单位', '说明']
  ]
  rows.push(['挂点孔位', rg.pointCount, rg.pointCount, '个', '孔位随版本作废重开'])
  rows.push(['挂绳', rg.ropeRawM.toFixed(3), rg.ropeM.toFixed(3), 'm', `含 ${(8).toFixed(0)}% 损耗；逐点长度见受力表`])
  rows.push(['吊环', rg.ringCount, Math.ceil(rg.ringCount * 1.05), '只', '直吊每点 1 / 斜吊每点 2，含 5% 损耗'])
  rows.push(['支座固定夹', rg.clampCount, Math.ceil(rg.clampCount * 1.05), '副', '每个支座 1 副'])
  rows.push(['加固件', rg.stiffenerCount, Math.ceil(rg.stiffenerCount * 1.05), '件', rg.stiffenerCount ? `用于超限段：${rg.stiffenerSegmentIds.join('、')}；加挂点/挪灯合格后可清零` : '本版全杆合格，无需加固件'])
  rows.push([])
  rows.push(['挂绳重', rg.ropeWeightG.toFixed(1), 'g', ''])
  rows.push(['吊环重', rg.ringWeightG.toFixed(1), 'g', ''])
  rows.push(['固定夹重', rg.clampWeightG.toFixed(1), 'g', ''])
  rows.push(['加固件重', rg.stiffenerWeightG.toFixed(1), 'g', ''])
  rows.push(['挂装五金合计重', rg.totalRiggingWeightG.toFixed(1), 'g', ''])
  rows.push([])
  rows.push(['横杆备料', (rg.beamStockMm / 1000).toFixed(3), '', 'm', `${r.section.name}，一整根；自重 ${rg.beamWeightKg}kg`])
  rows.push([])
  rows.push(['方案代价（取舍）', r.tradeoffs[r.strategy].beamNote])
  rows.push(['现场工时', r.tradeoffs[r.strategy].laborMinutes, '分钟', r.tradeoffs[r.strategy].laborNote])
  const other = r.strategy === 'even' ? 'weighted' : 'even'
  rows.push(['被放弃方案让出', r.tradeoffs[other].label, `峰值 ${r.tradeoffs[other].peakNm.toFixed(1)}N·m / ${r.tradeoffs[other].laborMinutes} 分钟`, '', r.tradeoffs[other].beamNote])
  return toCsv(rows)
}

export function kindName(k: FrameMember['kind']): string {
  const map: Record<FrameMember['kind'], string> = {
    vertical: '竖篾',
    ring: '横篾',
    mouth_ring: '收口圈',
    base_ring: '底盘圈',
    rib: '母线篾',
    spoke: '辐条/中轴'
  }
  return map[k]
}

export function shapeName(s: Panel['shape']): string {
  const map: Record<Panel['shape'], string> = {
    trapezoid: '梯形',
    rectangle: '矩形',
    sector: '扇形',
    circle: '圆形/正多边形',
    triangle: '三角形'
  }
  return map[s]
}
