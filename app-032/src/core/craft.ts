/** 本地打包的灯型库与工艺参数（断网可用，无运行期外部请求） */
import raw from '../data/lantern-types.json'
import type { Covering } from './types'

export interface CoveringSpec {
  id: Covering
  name: string
  gluePerM2: number
  /** 蒙面面密度（g/m²）——灯重与备料共用同一份材料清单 */
  areaWeightGPerM2: number
  wasteRatio: number
  color: string
  note: string
}

export interface BeamSectionSpec {
  id: string
  name: string
  shape: 'circle' | 'rect'
  /** 圆截面外径 / 矩形宽（mm） */
  diameterMm?: number
  /** 空心圆内径（mm，实心为 0） */
  innerDiameterMm?: number
  /** 矩形截面宽（mm） */
  widthMm?: number
  /** 矩形截面高（mm，竖直方向，决定抗弯） */
  heightMm?: number
  /** 杆料线密度（g/m） */
  weightGPerM: number
  /** 材料抗弯设计值（MPa = N/mm²） */
  allowableBendingMPa: number
  note: string
}

export interface SafetyTierSpec {
  id: string
  name: string
  /** 安全系数：容许弯矩 = 材料抗弯设计值 × 截面模量 / 安全系数 */
  factor: number
  note: string
}

export interface HangingCraft {
  ropeWeightGPerM: number
  ringWeightGEach: number
  clampWeightGEach: number
  stiffenerWeightGEach: number
  ropeWasteRatio: number
  hardwareWasteRatio: number
  installMinutesPerPointEven: number
  installMinutesPerPointWeighted: number
  redrillMinutesPerHole: number
  ropeTieMinutesPerPointExtra: number
}

export interface PresetParams {
  maxDiameterMm: number
  totalHeightMm: number
  mouthDiameterMm: number
  baseDiameterMm: number
  sides: number
  layerCount: number
  mouthStyle: 'flat' | 'taper' | 'gourd'
  bottomStyle: 'flat' | 'taper' | 'gourd'
  smoothness: number
  divisions?: number
  ctrl1?: { x: number; y: number }
  ctrl2?: { x: number; y: number }
  covering: Covering
  layerColors: string[]
  color: string
}

export interface LanternPreset {
  id: string
  name: string
  kind: 'prism' | 'revolution' | 'polyhedron' | 'box'
  tagline: string
  description: string
  params: PresetParams
}

export const CRAFT = raw.craft as {
  defaultLashAllowanceMm: number
  defaultSeamAllowanceMm: number
  defaultOverlapMm: number
  defaultDivisions: number
  divMin: number
  divMax: number
  lashPerJointM: number
  /** 竹篾/骨架条线密度（g/m）——取自同一份材料清单 */
  frameWeightGPerM: number
  /** 扎线线密度（g/m） */
  lashWeightGPerM: number
  ledWeightGEach: number
  batteryWeightGEach: number
  /** 每盏灯顶部吊挂小五金（挂钩/铁丝扣）重量（g） */
  suspensionHardwareWeightGEach: number
  /** 重力加速度（m/s²），先按克与牛算再换算千克 */
  gravity: number
  hanging: HangingCraft
  led: { perLiter: number; min: number; rule: string }
}

export const COVERINGS = raw.coverings as CoveringSpec[]
export const PRESETS = raw.presets as LanternPreset[]
export const BEAM_SECTIONS = raw.beamSections as BeamSectionSpec[]
export const SAFETY_TIERS = raw.safetyTiers as SafetyTierSpec[]

export function coveringSpec(id: Covering): CoveringSpec {
  return COVERINGS.find((c) => c.id === id) || COVERINGS[0]
}

export function beamSectionSpec(id: string): BeamSectionSpec {
  return BEAM_SECTIONS.find((b) => b.id === id) || BEAM_SECTIONS[0]
}

export function safetyTierSpec(id: string): SafetyTierSpec {
  return SAFETY_TIERS.find((t) => t.id === id) || SAFETY_TIERS[1]
}

export function presetById(id: string): LanternPreset | undefined {
  return PRESETS.find((p) => p.id === id)
}

export const KIND_LABELS: Record<string, string> = {
  prism: '正多棱柱',
  revolution: '旋转体',
  polyhedron: '多面体',
  box: '方形走马灯'
}

export const STYLE_LABELS: Record<string, string> = {
  flat: '平口',
  taper: '收口',
  gourd: '葫芦口'
}

export const COVERING_LABELS: Record<string, string> = {
  xuan: '宣纸',
  silk: '绸布',
  parchment: '羊皮纸'
}

export function kindLabel(k: string): string {
  return KIND_LABELS[k] || k
}

export function styleLabel(s: string): string {
  return STYLE_LABELS[s] || s
}

export function coveringLabel(c: string): string {
  return COVERING_LABELS[c] || c
}
