/**
 * 材料统计与备料单（规格书 §4.6 / §5）
 * 备料按含余量长度；批量 = 单灯 × N × (1 + 损耗率)。
 */
import type { FrameMember, Lantern } from './types'
import { bodySurfaceArea, bodyVolume, r1, r3 } from './geometry'
import { buildFrame } from './frame'
import { buildPanels } from './panels'
import { CRAFT, coveringSpec } from './craft'

export interface SingleLightMaterials {
  /** 竹篾/铁丝备料总长（含绑扎余量，m） */
  frameM: number
  /** 全部构件净长（m） */
  frameRawM: number
  /** 蒙面面积（含缝份，m²） */
  coveringM2: number
  /** 蒙面净面积（不含缝份，m²） */
  coveringNetM2: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** 绑扎处数 */
  lashJoints: number
  /** 灯体体积（L） */
  volumeL: number
  /** LED 建议颗数（不做电气设计，仅数量建议） */
  ledCount: number
  /** 灯体表面积（m²） */
  surfaceM2: number

  // ---- 单灯重量分项（g）：不另估，蒙面取自 buildPanels 的裁片面积、骨架取自 buildFrame 的备料长度，
  //      单位重量全部取自同一份材料清单 lantern-types.json；备料单重量与此处必须一致 ----
  /** 骨架重 = 备料总长（含绑扎余量，m）× 骨架条线密度 */
  frameWeightG: number
  /** 蒙面重 = 裁片面积合计（含缝份，m²）× 蒙面面密度（与备料统计同一面积口径，不按张数另算） */
  coveringWeightG: number
  /** 扎线重 */
  lashWeightG: number
  /** 胶重（按上胶量，计入整灯重量） */
  glueWeightG: number
  /** LED 灯珠重 */
  ledWeightG: number
  /** 灯内电池重（默认 1 节；重量档写明，不可另估） */
  batteryWeightG: number
  /** 顶部吊挂小五金（挂钩/铁丝扣）重 */
  hardwareWeightG: number
  /** 单灯总重（g）= 以上分项之和；受力模块只准取这一个数 */
  totalWeightG: number
  /** 单灯总重（kg，展示用，= totalWeightG / 1000） */
  totalWeightKg: number
}

export interface BatchMaterials extends SingleLightMaterials {
  count: number
  wasteRatio: number
}

export function computeMaterials(l: Lantern): SingleLightMaterials {
  const frame = buildFrame(l)
  const panelRes = buildPanels(l)
  const cov = coveringSpec(l.covering)
  const divisions = Math.max(3, Math.round(l.divisions))

  const frameMm = frame.members.reduce((s, m: FrameMember) => s + m.lengthMm * m.qty, 0)
  const frameRawMm = frame.members.reduce((s, m: FrameMember) => s + m.rawLengthMm * m.qty, 0)
  const joints = frame.members.reduce((s, m: FrameMember) => s + m.qty * m.lashJoints, 0)
  const cutArea = panelRes.cutAreaMm2
  const volumeL = bodyVolume(frame.geometry) / 1_000_000
  const led = Math.max(CRAFT.led.min, Math.ceil(volumeL * CRAFT.led.perLiter))

  // 重量（g）：长度走备料总长（含余量）、面积走裁片面积（含缝份），单位重量走同一份材料清单
  const frameWeightG = (frameMm / 1000) * CRAFT.frameWeightGPerM
  const coveringWeightG = (cutArea / 1_000_000) * cov.areaWeightGPerM2
  const lashM = joints * CRAFT.lashPerJointM
  const lashWeightG = lashM * CRAFT.lashWeightGPerM
  const glueG = (cutArea / 1_000_000) * cov.gluePerM2
  const ledWeightG = led * CRAFT.ledWeightGEach
  const batteryWeightG = CRAFT.batteryWeightGEach
  const hardwareWeightG = CRAFT.suspensionHardwareWeightGEach
  const totalWeightG =
    frameWeightG + coveringWeightG + lashWeightG + glueG + ledWeightG + batteryWeightG + hardwareWeightG

  return {
    frameM: r3(frameMm / 1000),
    frameRawM: r3(frameRawMm / 1000),
    coveringM2: r3(cutArea / 1_000_000),
    coveringNetM2: r3(panelRes.netAreaMm2 / 1_000_000),
    lashM: r3(lashM),
    glueG: r1(glueG),
    lashJoints: joints,
    volumeL: r3(volumeL),
    ledCount: led,
    surfaceM2: r3(bodySurfaceArea(frame.geometry, divisions) / 1_000_000),
    frameWeightG: r1(frameWeightG),
    coveringWeightG: r1(coveringWeightG),
    lashWeightG: r1(lashWeightG),
    glueWeightG: r1(glueG),
    ledWeightG: r1(ledWeightG),
    batteryWeightG: r1(batteryWeightG),
    hardwareWeightG: r1(hardwareWeightG),
    totalWeightG: r1(totalWeightG),
    totalWeightKg: r3(totalWeightG / 1000)
  }
}

/** 批量化：单灯 × N × (1 + 损耗率)；LED/电池/五金按颗数/件数 × N（不参与损耗率）；重量同口径 */
export function computeBatch(single: SingleLightMaterials, count: number, wasteRatio: number): BatchMaterials {
  const k = count * (1 + wasteRatio)
  return {
    ...single,
    count,
    wasteRatio,
    frameM: r3(single.frameM * k),
    frameRawM: r3(single.frameRawM * k),
    coveringM2: r3(single.coveringM2 * k),
    coveringNetM2: r3(single.coveringNetM2 * k),
    lashM: r3(single.lashM * k),
    glueG: r1(single.glueG * k),
    volumeL: r3(single.volumeL * count),
    ledCount: single.ledCount * count,
    surfaceM2: r3(single.surfaceM2 * count),
    // 骨架/蒙面/扎线/胶随料走损耗；LED/电池/五金按件 ×N 不打损耗
    frameWeightG: r1(single.frameWeightG * k),
    coveringWeightG: r1(single.coveringWeightG * k),
    lashWeightG: r1(single.lashWeightG * k),
    glueWeightG: r1(single.glueWeightG * k),
    ledWeightG: r1(single.ledWeightG * count),
    batteryWeightG: r1(single.batteryWeightG * count),
    hardwareWeightG: r1(single.hardwareWeightG * count),
    totalWeightG: r1(single.totalWeightG * count),
    totalWeightKg: r3((single.totalWeightG * count) / 1000)
  }
}
