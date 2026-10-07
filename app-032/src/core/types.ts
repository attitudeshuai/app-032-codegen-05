/** 花灯放样数据模型（对齐规格书 §7，并补充放样所需的展开参数） */

export type LanternKind = 'prism' | 'revolution' | 'polyhedron' | 'box'
export type MouthStyle = 'flat' | 'taper' | 'gourd'
export type Covering = 'xuan' | 'silk' | 'parchment'
export type PageSize = 'A4' | 'A3'
export type PanelShape = 'trapezoid' | 'rectangle' | 'sector' | 'circle' | 'triangle'
export type MemberKind = 'vertical' | 'ring' | 'mouth_ring' | 'base_ring' | 'rib' | 'spoke'

/** 挂点分摊方式：等分布置 / 按实际吊重分摊 */
export type HangingStrategyId = 'equal' | 'load'
/** 写明的安全档位 */
export type SafetyGradeId = 'tight' | 'normal' | 'loose'

export interface Point2 {
  x: number
  y: number
}

/** 分段（层）：高度为准，直径为轮廓派生结果 */
export interface LayerSpec {
  heightMm: number
  diameterMm: number
}

export interface Lantern {
  id: string
  kind: LanternKind
  name: string
  /** 最大直径（灯体最粗处） */
  maxDiameterMm: number
  /** 总高（= 各分段高度之和） */
  totalHeightMm: number
  /** 收口直径（上口） */
  mouthDiameterMm: number
  /** 底口直径（下口） */
  baseDiameterMm: number
  /** 棱数（prism/box）；旋转体时作为竖篾（母线篾）根数 */
  sides: number
  /** 分段高度与直径 */
  layers: LayerSpec[]
  /** 上收口方式 */
  mouthStyle: MouthStyle
  /** 下收口方式 */
  bottomStyle: MouthStyle
  /** 收口曲线强度 0~1 */
  smoothness: number
  /** 葫芦/花瓶形贝塞尔控制点（归一化：x 为半径插值比例，y 为肩部区间比例） */
  ctrl1: Point2
  ctrl2: Point2
  /** 旋转体母线等分数（默认 24，可调） */
  divisions: number
  /** 蒙面类型 */
  covering: Covering
  /** 缝份（mm，四边各加） */
  seamAllowanceMm: number
  /** 绑扎余量（mm，每端） */
  lashAllowanceMm: number
  /** 每层配色（长度 = layers.length，可短于层数则回落到主色） */
  layerColors: string[]
  /** 主色 */
  color: string
  /** 批量制灯数量 */
  batchCount: number
  /** 损耗率 0~0.2 */
  wasteRatio: number
  /** 1:1 打印纸张 */
  pageSize: PageSize
  /** 长条图跨页搭接量（mm） */
  overlapMm: number
  /** 门廊横杆悬挂布置（不填则按默认值现算） */
  hanging?: HangingSetup
  createdAt: string
  updatedAt: string
}

export interface FrameMember {
  id: string
  kind: MemberKind
  /** 名称，如「竖篾」「第 3 层横篾」「收口圈」 */
  label: string
  /** 截取长度（已含绑扎余量） */
  lengthMm: number
  /** 净长（不含余量） */
  rawLengthMm: number
  /** 建议弯曲半径（圆形圈 / 收口段） */
  bendRadiusMm?: number
  /** 折角（多边形圈的转角，度） */
  bendAngleDeg?: number
  /** 数量 */
  qty: number
  /** 分组：所属层或类别 */
  group: string
  /** 每根含几处绑扎余量 */
  lashJoints: number
  note?: string
}

export interface PanelMark {
  x: number
  y: number
  label: string
}

export interface Panel {
  id: string
  label: string
  shape: PanelShape
  /** 裁片下宽（已含缝份） */
  widthBottomMm: number
  /** 裁片上宽（已含缝份） */
  widthTopMm: number
  /** 裁片高（已含缝份） */
  heightMm: number
  seamAllowanceMm: number
  marksMm: PanelMark[]
  qty: number
  /** 展开净尺寸（不含缝份） */
  rawWidthTopMm: number
  rawWidthBottomMm: number
  rawHeightMm: number
  /** 圆形/正多边形裁片半径（净，不含缝份） */
  radiusMm?: number
  /** 正多边形边数（顶/底盖为多边形时） */
  polySides?: number
  /** 对应灯体层的索引（-1 表示顶/底盖） */
  layerIndex: number
  color: string
  note?: string
}

export interface MaterialTally {
  /** 备料竹篾/铁丝总长（m，含绑扎余量与损耗） */
  frameM: number
  /** 蒙面面积（m²，含缝份与损耗） */
  coveringM2: number
  /** 损耗率 */
  wasteRatio: number
  /** 扎线（m） */
  lashM: number
  /** 胶（g） */
  glueG: number
  /** LED 灯珠建议数量 */
  ledCount?: number
}

/** 构件与裁片的自检结果（对应规格书 §10） */
export interface CheckResult {
  id: string
  title: string
  pass: boolean
  detail: string
  /** 相关数值，便于界面展示 */
  value?: string
}

// ===================== 挂点布置与受力核定 =====================

/** 一个挂点上挂的灯（同一灯样，数量 ≥1） */
export interface HangingLight {
  id: string
  /** 该点吊几盏（同种灯样） */
  qty: number
  /** 挂点 x 坐标（mm，自横杆左端 0 起）；等分法下留 0 由布置推算 */
  xMm: number
}

/** 已打孔/已采用的布置快照（存本机；输入摘要一变即作废，孔要重开） */
export interface HangingCommit {
  strategy: HangingStrategyId
  /** 已采用时的输入摘要（见 hangingDigest） */
  digest: string
  /** 已打孔位置（mm 取整），逐点 */
  holesMm: number[]
  /** 已采用的安全档位 */
  grade: SafetyGradeId
  /** 采用时刻 */
  committedAt: string
  /** 已导出受力表的摘要（导出即登记；变了旧表作废） */
  exportedDigest?: string
  exportedAt?: string
}

/** 挂点布置输入（挂在哪个灯样上，即“这一串”用该灯样） */
export interface HangingSetup {
  /** 横杆总长（mm） */
  rodLengthMm: number
  /** 左支座离左端（挑出端长度，mm） */
  leftSupportMm: number
  /** 右支座离右端（挑出端长度，mm） */
  rightSupportMm: number
  /** 横杆料 id（材料清单 rods） */
  rodId: string
  /** 安全档位 */
  grade: SafetyGradeId
  /** 受力分摊二选一 */
  strategy: HangingStrategyId
  /** 这一串共挂几盏（等分法自动分到各点；按吊重法取 groups 之和） */
  lightCount: number
  /** 等分布置用：挂几个点 */
  equalPointCount: number
  /** 按实际吊重分摊用：逐点交代的分组（位置与每点灯数） */
  groups: HangingLight[]
  /** 绳下垂净空（mm，灯顶到横杆） */
  dropMm: number
  /** 已采用（已打孔）的布置快照；输入一变即整体作废重算 */
  commit?: HangingCommit | null
}

