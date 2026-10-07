/** 导出：构件清单 / 裁片清单 / 备料单 / 挂杆受力表（CSV，本地生成，无外部请求） */
import type { FrameMember, Lantern, Panel } from './types'
import type { BatchMaterials, SingleLightMaterials } from './materials'
import { coveringSpec } from './craft'
import type { HangingResult } from './hanging'
import { fM, fT, fX, fG, fS } from './hanging'

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
  batch: BatchMaterials,
  hanging?: HangingResult
): string {
  const cov = coveringSpec(l.covering)
  const rows: (string | number)[][] = [
    [`备料单 · ${l.name}`],
    [`生成 ${new Date().toLocaleString()} / 单位 mm·m²·m·g${hanging ? ` / 挂杆受力同源指纹 ${hanging.digest}` : ''}`],
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
    ['灯体体积', single.volumeL.toFixed(3), 'L', batch.volumeL.toFixed(3)],
    ['灯体表面积', single.surfaceM2.toFixed(3), 'm²', batch.surfaceM2.toFixed(3)]
  ]

  // ---- 挂杆挂件：行数与米数全部取自同一份 HangingResult（材料页/预览/本表同源） ----
  if (hanging) {
    const w = hanging.weight
    rows.push(
      [],
      [`—— 门廊横杆挂件备料（受力指纹 ${hanging.digest}，与受力表完全同源）——`],
      ['单灯悬挂重量（蒙面按面积/骨架按备料长度，同一材料清单）', fG(w.totalG), 'g', fG(w.totalG * batch.count)],
      [`其中：蒙面 ${cov.name} ${single.coveringM2.toFixed(3)}m² × ${w.basis.coveringGM2}g/m²`, fG(w.coveringG), 'g', '—'],
      [`其中：竹篾骨架 ${single.frameM.toFixed(3)}m × ${w.basis.frameGPerM}g/m`, fG(w.frameG), 'g', '—']
    )
    for (const r of hanging.hardware.ropeLines) {
      rows.push([`挂绳（${r.spec.name}，许用 ${r.spec.ratedN}N）`, r.lengthM.toFixed(2), 'm', `本杆 ${r.lengthM.toFixed(2)}m（${fG(r.weightG)}g）× 杆数`])
    }
    for (const r of hanging.hardware.ringLines) {
      rows.push([`吊环（${r.spec.name}，许用 ${r.spec.ratedN}N，含 2 个支座固定环）`, r.qty, '个', `本杆 ${r.qty} 个 × 杆数（${fG(r.spec.weightG * r.qty)}g）`])
    }
    rows.push(
      ['加固件（钢套管，长100mm，含钉）', hanging.hardware.braceQty, '件', `本杆 ${hanging.hardware.braceQty} 件 × 杆数（${hanging.hardware.braceTotalG}g）`],
      ['挂点孔 + 支座孔（合计）', hanging.hardware.holeCount, '个', '—'],
      ['现场绑扎/打孔估工', hanging.hardware.laborMin, 'min', '—']
    )
  }
  return toCsv(rows)
}

/**
 * 受力表 CSV：挂点拉力、支座反力、逐段弯矩、档位判定、改法。
 * 与预览页/材料页同一次 computeHanging() 结果；内嵌 digest 供对账。
 */
export function forceTableCsv(l: Lantern, h: HangingResult): string {
  const rows: (string | number)[][] = [
    [`门廊横杆受力表 · ${l.name}`],
    [
      `生成 ${new Date().toLocaleString()} / 受力同源指纹 ${h.digest} / 杆长 ${fX(h.setup.rodLengthMm)}mm / 杆料 ${h.rod.name} / 档位 ${h.grade.spec.name} / 分摊法 ${h.setup.strategy === 'equal' ? '按挂点等分' : '按实际吊重分摊'}`
    ],
    ['单位约定：长度 mm 取整；拉力 N 保留 1 位小数；弯矩 N·m 保留 2 位小数（内部按 g→N 计算，kg 仅换算展示）；g=9.80665'],
    [],
    ['单灯重量分解', '克重(g)', '取数依据'],
    [`蒙面（${coveringSpec(l.covering).name}）`, fG(h.weight.coveringG), `${h.weight.basis.coveringM2.toFixed(3)}m²（含缝份，同备料单）× ${h.weight.basis.coveringGM2}g/m²`],
    ['竹篾骨架', fG(h.weight.frameG), `${h.weight.basis.frameM.toFixed(3)}m（含绑扎余量，同备料单）× ${h.weight.basis.frameGPerM}g/m`],
    ['胶', fG(h.weight.glueG), '同备料单用胶'],
    ['扎线', fG(h.weight.lashG), `${h.weight.basis.lashM.toFixed(3)}m × ${h.weight.basis.lashGPerM}g/m`],
    ['LED（含导线）', fG(h.weight.ledG), `${h.weight.basis.ledCount} 颗 × ${h.weight.basis.ledEachG}g`],
    ['收口挂钩小件', fG(h.weight.fittingsG), `1 × ${h.weight.basis.fittingsEachG}g`],
    ['单灯合计', fG(h.weight.totalG), `${fT(h.weight.totalN)}N（${h.weight.totalKg.toFixed(3)}kg）`],
    [],
    ['挂点编号', '位置x(mm)', '灯数(盏)', '灯重拉力(N)', '挂点总拉力(N)', '折合(kg)', '吊法', '每股拉力(N)', '绳规格/单股许用(N)', '绳长(m)', '吊环/许用(N)', '说明']
  ]
  for (const p of h.points) {
    rows.push([
      p.id,
      fX(p.xMm),
      p.qty,
      fT(p.lampsN),
      fT(p.tensionN),
      p.tensionKg.toFixed(2),
      p.doubleSling ? '双吊索' : '单股直吊',
      fT(p.perLegN),
      `${p.rope.name} / ${p.rope.ratedN}`,
      p.ropeLengthM.toFixed(2),
      `${p.ring.name} / ${p.ring.ratedN}`,
      p.note
    ])
  }
  rows.push(
    [],
    ['支座', '位置x(mm)', '反力(N，节点法)', '反力(N，均布整杆核对)', '折合(kg)', '状态', '固定环/许用(N)']
  )
  for (const s of h.supports) {
    rows.push([
      s.id,
      fX(s.xMm),
      fT(s.reactionN),
      fT(s.exactN),
      s.reactionKg.toFixed(2),
      s.uplift ? '上拔！需压重/锚固' : '下压',
      `${s.ring.name} / ${s.ring.ratedN}`
    ])
  }
  rows.push(
    [],
    ['段号', '起点(mm)', '终点(mm)', '部位', '极值弯矩(N·m)', '极值位置(mm)', '极值在挂点/支座', '整杆核对弯矩(N·m)', '极值剪力(N)', '应力(MPa)', '挠度(mm)', '加固']
  )
  h.segments.forEach((s) => {
    rows.push([
      s.index,
      fX(s.fromMm),
      fX(s.toMm),
      s.kind === 'span' ? '跨间' : s.kind === 'left-overhang' ? '左挑出端' : '右挑出端',
      fM(s.maxNodeMNmm),
      fX(s.maxAtMm),
      s.maxAtEvent ? '是' : '否',
      fM(s.maxExactMNmm),
      fT(s.maxShearN),
      fS(s.stressMPa),
      fT(s.deflectionMm),
      s.braced ? '钢套管' : '—'
    ])
  })
  rows.push(
    [],
    ['安全档位', h.grade.spec.name, `许用应力 ${fS(h.grade.allowStressMPa)}MPa × ${(h.grade.spec.stressRatio * 100).toFixed(0)}% = ${fS(h.grade.limitStressMPa)}MPa`, `挠度限值 跨/${h.grade.spec.deflectionRatio} = ${fX(h.grade.allowDeflectionMm)}mm`],
    ['核定结论', h.pass ? '通过' : '超档', h.pass ? '全部杆段应力与挠度在档位内' : `超档段：${h.grade.failingSegments.map(String).join('、') || '无'}${h.grade.upliftSupports.length ? '；支座 ' + h.grade.upliftSupports.join('、') + ' 上拔' : ''}`, ''],
    ['对账', '力平衡残差(N)', fT(h.equilibrium.residualN), `杆端闭合弯矩 ${fM(h.equilibrium.tipClosureNmm)}N·m；极值偏差 ${h.equilibrium.exactDevPct.toFixed(2)}%`]
  )
  if (!h.pass) {
    rows.push([], ['改法', '动作', '改后最大弯矩(N·m)', '改后应力利用', '增加绳(m)', '增加吊环(个)', '增加加固(件)', '增加工时(min)', '代价与取舍'])
    for (const fx of h.fixes) {
      rows.push([
        fx.id === 'add-point' ? '加挂点' : '把灯挪开',
        fx.action,
        fM(fx.projectedMaxMNm * 1000),
        `${(fx.projectedMaxStressRatio * 100).toFixed(0)}%${fx.pass ? '（过档）' : '（仍不过）'}`,
        fx.addedRopeM.toFixed(2),
        fx.addedRings,
        fx.addedBraces,
        fx.addedLaborMin,
        fx.tradeoff
      ])
    }
  }
  rows.push(
    [],
    ['分摊法取舍', h.tradeoff.chosenCostText],
    ['被放弃方案让出', h.tradeoff.rejectedYieldText],
    [],
    ['三处同源声明', `本指纹 ${h.digest} 同时出现在预览页标注、材料页挂件行与本受力表；改蒙面材料/加灯/挪灯后整杆重算，旧指纹版本（含已打孔位、分组、安全余量判定、配绳长度与已导出表）一律作废。`]
  )
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
