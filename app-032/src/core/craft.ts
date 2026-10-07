/** 本地打包的灯型库与工艺参数（断网可用，无运行期外部请求） */
import raw from '../data/lantern-types.json'
import type { Covering, SafetyGradeId } from './types'

export interface CoveringSpec {
  id: Covering
  name: string
  gluePerM2: number
  /** 蒙面材料面密度（g/m²）——挂杆受力核定与备料单共用这一份 */
  weightGM2: number
  wasteRatio: number
  color: string
  note: string
}

export interface RopeSpec {
  id: string
  name: string
  weightGPerM: number
  ratedN: number
  note: string
}

export interface RingSpec {
  id: string
  name: string
  weightG: number
  ratedN: number
  note: string
}

export interface RodSpec {
  id: string
  name: string
  densityKgM3: number
  outerDiamMm: number
  innerDiamMm: number
  sectionShape: 'annulus' | 'rect'
  bMm?: number
  hMm?: number
  bendAllowMPa: number
  emodGPa: number
  pricePerM: number
  note: string
}

export interface SafetyGradeSpec {
  id: SafetyGradeId
  name: string
  stressRatio: number
  deflectionRatio: number
  note: string
}

export interface HangingCatalog {
  gravity: number
  frameBamboo: { id: string; name: string; weightGPerM: number; note: string }
  extras: { lashGPerM: number; ledEachG: number; fittingsEachG: number; note: string }
  ropes: RopeSpec[]
  rings: RingSpec[]
  brace: { id: string; name: string; weightG: number }
  rods: RodSpec[]
  grades: SafetyGradeSpec[]
  labor: {
    drillMin: number
    tiePerPointMin: number
    tiePerLampMin: number
    ringInstallMin: number
    cutRopeExtraM: number
    slingSpreadMm: number
    note: string
  }
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
  led: { perLiter: number; min: number; rule: string }
}

export const COVERINGS = raw.coverings as CoveringSpec[]
export const PRESETS = raw.presets as LanternPreset[]
export const HANGING_CATALOG = raw.hanging as HangingCatalog

export function coveringSpec(id: Covering): CoveringSpec {
  return COVERINGS.find((c) => c.id === id) || COVERINGS[0]
}

export function rodSpec(id: string): RodSpec {
  return HANGING_CATALOG.rods.find((r) => r.id === id) || HANGING_CATALOG.rods[0]
}

export function gradeSpec(id: SafetyGradeId): SafetyGradeSpec {
  return HANGING_CATALOG.grades.find((g) => g.id === id) || HANGING_CATALOG.grades[1]
}

/** 选满足单股拉力的最细一档绳（材料清单同一处选型） */
export function pickRope(perLegN: number): RopeSpec {
  const fit = HANGING_CATALOG.ropes.filter((r) => r.ratedN >= perLegN)
  return fit[0] || HANGING_CATALOG.ropes[HANGING_CATALOG.ropes.length - 1]
}

/** 选满足拉力的最小一档吊环 */
export function pickRing(loadN: number): RingSpec {
  const fit = HANGING_CATALOG.rings.filter((r) => r.ratedN >= loadN)
  return fit[0] || HANGING_CATALOG.rings[HANGING_CATALOG.rings.length - 1]
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
