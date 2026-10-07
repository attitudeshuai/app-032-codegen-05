/**
 * 挂点布置存储（与灯样库分开的一块 localStorage）
 * 每个灯样一份：横杆参数 + 挂灯清单 + 分摊方案 + 已采用版本。
 * 改蒙面材料/加灯/挪灯触发整杆重算并升版本；旧版布置、旧孔位、旧受力表作废（UI 与导出均写明）。
 */
import { reactive, watch } from 'vue'
import type { Lantern } from './types'
import {
  computeHanging,
  defaultBeamConfig,
  makeHangingItem,
  type BeamConfig,
  type DistributionStrategy,
  type HangingItem,
  type HangingResult
} from './hanging'

const KEY = 'lantern-hanging-layout.v1'

interface HangingState {
  beam: BeamConfig
  strategy: DistributionStrategy
  items: HangingItem[]
  /** 已采用版本（用于标注旧孔位作废；模拟改法不升版本，点「采用」才落地） */
  adoptedRevision: number
  /** 上一次被放弃的方案（用于写明让出多少杆料/工时） */
  rejectedStrategy: DistributionStrategy | null
}

interface Store {
  byLantern: Record<string, HangingState>
  ready: boolean
  storageError: string
}

const state = reactive<Store>({ byLantern: {}, ready: false, storageError: '' })

let timer: number | undefined
let suspend = false

function seed(lantern: Lantern): HangingState {
  const beam = defaultBeamConfig()
  // 初始一串灯：按当前灯样在两支座间等距挂 4 盏
  const items: HangingItem[] = Array.from({ length: 4 }, (_, i) =>
    makeHangingItem(
      lantern,
      beam.leftSupportMm + ((beam.rightSupportMm - beam.leftSupportMm) * (i + 0.5)) / 4,
      1
    )
  )
  return { beam, strategy: 'even', items, adoptedRevision: 0, rejectedStrategy: null }
}

export function ensureState(lanternId: string, lantern?: Lantern): HangingState {
  let s = state.byLantern[lanternId]
  if (!s && lantern) {
    s = seed(lantern)
    state.byLantern[lanternId] = s
  }
  return s
}

export function getState(lanternId: string): HangingState | undefined {
  return state.byLantern[lanternId]
}

export function patchBeam(lanternId: string, patch: Partial<BeamConfig>) {
  const s = state.byLantern[lanternId]
  if (!s) return
  // 支座位置合法性：不越杆、左在右左
  const b = { ...s.beam, ...patch }
  b.lengthMm = Math.max(500, Math.round(b.lengthMm))
  b.leftSupportMm = Math.min(Math.max(0, Math.round(b.leftSupportMm)), b.lengthMm - 200)
  b.rightSupportMm = Math.min(Math.max(b.leftSupportMm + 200, Math.round(b.rightSupportMm)), b.lengthMm)
  s.beam = b
}

export function setStrategy(lanternId: string, strategy: DistributionStrategy) {
  const s = state.byLantern[lanternId]
  if (!s || s.strategy === strategy) return
  s.rejectedStrategy = s.strategy
  s.strategy = strategy
}

export function addItem(lantern: Lantern, desiredX?: number, qty = 1): HangingItem {
  const s = ensureState(lantern.id, lantern)
  const x = desiredX ?? Math.round((s.beam.leftSupportMm + s.beam.rightSupportMm) / 2)
  const item = makeHangingItem(lantern, x, qty)
  s.items.push(item)
  return item
}

export function addItemOf(lanternId: string, item: HangingItem) {
  const s = state.byLantern[lanternId]
  if (s) s.items.push(item)
}

export function removeItem(lanternId: string, itemId: string) {
  const s = state.byLantern[lanternId]
  if (!s) return
  s.items = s.items.filter((i) => i.id !== itemId)
}

export function moveItem(lanternId: string, itemId: string, xMm: number) {
  const s = state.byLantern[lanternId]
  const it = s?.items.find((i) => i.id === itemId)
  if (!it) return
  it.desiredX = Math.max(0, Math.min(s!.beam.lengthMm, Math.round(xMm)))
}

export function setItemQty(lanternId: string, itemId: string, qty: number) {
  const it = state.byLantern[lanternId]?.items.find((i) => i.id === itemId)
  if (it) it.qty = Math.max(1, Math.min(20, Math.round(qty)))
}

export function clearItems(lanternId: string) {
  const s = state.byLantern[lanternId]
  if (s) s.items = []
}

/** 采用某次改法模拟的结果：把模拟中的挂灯清单落地（加孔/挪灯），并记版本 */
export function applyItems(lanternId: string, items: HangingItem[], strategy: DistributionStrategy) {
  const s = state.byLantern[lanternId]
  if (!s) return
  s.items = items.map((i) => ({ ...i }))
  s.strategy = strategy
}

export function markAdopted(lanternId: string, revision: number) {
  const s = state.byLantern[lanternId]
  if (s) s.adoptedRevision = revision
}

/** 三处同源的唯一取数口：预览页、材料页、导出都调它 */
export function useHangingResult(
  lantern: () => Lantern | undefined,
  resolveLantern: (id: string) => Lantern | undefined
): { result: () => HangingResult | null } {
  // 返回一个取值函数，内部做惰性计算（在 Vue computed 中调用即随依赖重算）
  return {
    result: () => {
      const l = lantern()
      if (!l) return null
      const s = ensureState(l.id, l)
      return computeHanging(l, s.beam, s.strategy, s.items, resolveLantern)
    }
  }
}

function persist() {
  suspend = true
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, byLantern: state.byLantern }))
    state.storageError = ''
  } catch (e) {
    state.storageError = e instanceof Error ? e.message : String(e)
  } finally {
    suspend = false
  }
}

function schedulePersist() {
  if (timer !== undefined) window.clearTimeout(timer)
  timer = window.setTimeout(persist, 200)
}

export function loadHangingStore() {
  if (state.ready) return
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as { byLantern?: Record<string, HangingState> }
      if (data.byLantern && typeof data.byLantern === 'object') {
        // 合并默认值，兼容旧存档缺少新横杆字段
        for (const [id, s] of Object.entries(data.byLantern)) {
          state.byLantern[id] = { ...seedSafe(s), beam: { ...defaultBeamConfig(), ...s.beam }, items: s.items || [] }
        }
      }
    }
  } catch {
    state.storageError = '挂点布置数据损坏，已忽略本地存档'
  }
  state.ready = true
  watch(
    () => state.byLantern,
    () => {
      if (!suspend) schedulePersist()
    },
    { deep: true }
  )
}

function seedSafe(s: HangingState): HangingState {
  return {
    beam: defaultBeamConfig(),
    strategy: s.strategy || 'even',
    items: [],
    adoptedRevision: s.adoptedRevision || 0,
    rejectedStrategy: s.rejectedStrategy ?? null
  }
}
