<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BeamDiagram from '../components/BeamDiagram.vue'
import { getLantern, state as lanternState } from '../core/store'
import {
  addItem,
  addItemOf,
  clearItems,
  ensureState,
  markAdopted,
  moveItem,
  patchBeam,
  removeItem,
  setItemQty,
  setStrategy
} from '../core/hangingStore'
import { computeHanging, makeHangingItem, utilizationMaxOf, type HangingResult } from '../core/hanging'
import { BEAM_SECTIONS, SAFETY_TIERS, coveringLabel } from '../core/craft'
import { downloadText, forceTableCsv, riggingCsv } from '../core/exporter'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))

const hs = computed(() => (lantern.value ? ensureState(lantern.value.id, lantern.value) : null))

function resolveLantern(id: string) {
  return lanternState.lanterns.find((l) => l.id === id)
}

/** 三处同源的唯一结果：本页、参数预览页、材料页、导出都调 computeHanging 同一函数 */
const result = computed<HangingResult | null>(() => {
  const l = lantern.value
  const s = hs.value
  if (!l || !s) return null
  return computeHanging(l, s.beam, s.strategy, s.items, resolveLantern)
})

const draftX = ref(1500)
const draftQty = ref(1)

function addLanternAt(x?: number) {
  const l = lantern.value
  if (!l) return
  addItem(l, x ?? draftX.value, draftQty.value)
}

function addAnotherLantern(id: string) {
  const src = resolveLantern(id)
  const l = lantern.value
  if (!src || !l) return
  const item = makeHangingItem(src, draftX.value, draftQty.value)
  addItemOf(l.id, item)
}

function onMove(itemId: string, e: Event) {
  const l = lantern.value
  if (!l) return
  moveItem(l.id, itemId, Number((e.target as HTMLInputElement).value))
}
function onQty(itemId: string, e: Event) {
  const l = lantern.value
  if (!l) return
  setItemQty(l.id, itemId, Number((e.target as HTMLInputElement).value))
}
function onRemove(itemId: string) {
  const l = lantern.value
  if (!l) return
  removeItem(l.id, itemId)
}
function onClear() {
  const l = lantern.value
  if (l && window.confirm('清空全部挂灯？将整杆重算（无挂点时不产生挂点）。')) clearItems(l.id)
}
function chooseStrategy(s: 'even' | 'weighted') {
  const l = lantern.value
  if (!l) return
  setStrategy(l.id, s)
}

function exportForce() {
  const l = lantern.value
  if (!l || !result.value) return
  downloadText(`${l.name}-受力表-第${result.value.revision}版.csv`, forceTableCsv(l, result.value))
}
function exportRigging() {
  const l = lantern.value
  if (!l || !result.value) return
  downloadText(`${l.name}-挂装备料单-第${result.value.revision}版.csv`, riggingCsv(l, result.value))
}

/** 采用某条改法的模拟结果（加挂点/挪灯落地，旧孔位随版本作废） */
function adoptFix(r: HangingResult) {
  const l = lantern.value
  if (!l) return
  const s = hs.value!
  s.items = r.items.map((i) => ({ ...i }))
  markAdopted(l.id, r.revision)
}

const utilMax = computed(() => (result.value ? utilizationMaxOf(result.value) : 0))
const otherLanterns = computed(() => lanternState.lanterns.filter((l) => l.id !== lantern.value?.id).slice(0, 8))

const beam = computed(() => hs.value?.beam)
</script>

<template>
  <div v-if="!lantern || !hs || !result || !beam" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="hang">
    <section class="head">
      <div>
        <h2>挂点布置与受力核定 · {{ lantern.name }}</h2>
        <p class="sub">
          灯重取自既有「蒙面裁片与缝份、备料统计与材料页」已算出的数：蒙面按<b>含缝份裁片面积 × 同一份材料清单面密度</b>、
          骨架按<b>备料总长 × 线密度</b>，受力/预览/材料/导出四处共用单灯总重
          <b>{{ result.items[0]?.unitWeightG ?? '—' }}g</b>，不按张数另估。
        </p>
      </div>
      <div class="ops">
        <button @click="exportForce">导出受力表 CSV</button>
        <button @click="exportRigging">导出挂装备料单 CSV</button>
        <button class="primary" @click="router.push(`/materials/${lantern.id}`)">去材料页核对</button>
      </div>
    </section>

    <!-- 版本/作废条 -->
    <section class="rev" :class="{ stale: hs.adoptedRevision && hs.adoptedRevision < result.revision }">
      <div class="rev-main">
        <b>第 {{ result.revision }} 版受力结果</b>
        <span v-if="hs.adoptedRevision && hs.adoptedRevision < result.revision" class="stale-tag">
          已施工的第 {{ hs.adoptedRevision }} 版已作废：旧挂点孔要重开、旧分组/安全判定/配绳长度全部失效
        </span>
        <span v-else-if="!hs.adoptedRevision" class="fresh-tag">尚未施工，当前为最新核定版</span>
        <span v-else class="ok-tag">与已施工版本一致</span>
      </div>
      <button v-if="hs.adoptedRevision !== result.revision" class="mini" @click="markAdopted(lantern.id, result.revision)">
        标记本版为已施工
      </button>
      <p class="rev-note">{{ result.voidedNote }}</p>
    </section>

    <div class="grid">
      <!-- 左：参数 -->
      <section class="panel params">
        <h3>横杆与支座</h3>
        <div class="row">
          <label>横杆总长 (mm)
            <input :value="beam.lengthMm" type="number" min="500" max="12000" step="50"
              @change="patchBeam(lantern.id, { lengthMm: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label>左支座 (mm)
            <input :value="beam.leftSupportMm" type="number" min="0" :max="beam.lengthMm - 200" step="10"
              @change="patchBeam(lantern.id, { leftSupportMm: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label>右支座 (mm)
            <input :value="beam.rightSupportMm" type="number" :min="beam.leftSupportMm + 200" :max="beam.lengthMm" step="10"
              @change="patchBeam(lantern.id, { rightSupportMm: Number(($event.target as HTMLInputElement).value) })" />
          </label>
        </div>
        <div class="row">
          <label>横杆材料规格
            <select :value="beam.sectionId" @change="patchBeam(lantern.id, { sectionId: ($event.target as HTMLSelectElement).value })">
              <option v-for="b in BEAM_SECTIONS" :key="b.id" :value="b.id">{{ b.name }}（{{ b.weightGPerM }}g/m，{{ b.allowableBendingMPa }}MPa）</option>
            </select>
          </label>
          <label>安全档位
            <select :value="beam.tierId" @change="patchBeam(lantern.id, { tierId: ($event.target as HTMLSelectElement).value })">
              <option v-for="t in SAFETY_TIERS" :key="t.id" :value="t.id">{{ t.name }}（×{{ t.factor }}）</option>
            </select>
          </label>
        </div>
        <p class="hint">{{ result.section.note }}；{{ result.tier.note }}</p>
        <p class="hint">
          截面模量 W = {{ result.sectionModulusMm3 }}mm³；容许弯矩 = {{ result.segments[0]?.allowableNm.toFixed(1) }}N·m
          （{{ result.section.allowableBendingMPa }}MPa × W ÷ {{ result.tier.factor }}）
        </p>

        <h3>挂绳走法</h3>
        <div class="row">
          <label>走法
            <select :value="beam.ropeStyle" @change="patchBeam(lantern.id, { ropeStyle: ($event.target as HTMLSelectElement).value as 'straight' | 'bridle' })">
              <option value="straight">竖直单吊（每点 1 绳 1 环）</option>
              <option value="bridle">双股斜吊（每点 2 绳 2 环）</option>
            </select>
          </label>
          <label>落差 (mm)
            <input :value="beam.ropeDropMm" type="number" min="100" max="3000" step="10"
              @change="patchBeam(lantern.id, { ropeDropMm: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <label v-if="beam.ropeStyle === 'bridle'">斜角 (°)
            <input :value="beam.bridleAngleDeg" type="number" min="10" max="85" step="1"
              @change="patchBeam(lantern.id, { bridleAngleDeg: Number(($event.target as HTMLInputElement).value) })" />
          </label>
        </div>
        <label class="chk"><input type="checkbox" :checked="beam.includeBeamWeight"
          @change="patchBeam(lantern.id, { includeBeamWeight: ($event.target as HTMLInputElement).checked })" /> 计入横杆自重（{{ result.rigging.beamWeightKg }}kg）</label>

        <h3>受力分摊（二选一，取舍写在下方）</h3>
        <div class="strat">
          <button :class="{ on: result.strategy === 'even' }" @click="chooseStrategy('even')">按挂点等分</button>
          <button :class="{ on: result.strategy === 'weighted' }" @click="chooseStrategy('weighted')">按实际吊重分摊</button>
        </div>
        <div class="trade">
          <div v-for="key in ['even', 'weighted']" :key="key" class="trade-card" :class="{ chosen: result.strategy === key }">
            <h4>{{ result.tradeoffs[key as 'even' | 'weighted'].label }}
              <em v-if="result.strategy === key">（采用）</em>
            </h4>
            <p>{{ result.tradeoffs[key as 'even' | 'weighted'].beamNote }}</p>
            <p>{{ result.tradeoffs[key as 'even' | 'weighted'].laborNote }}</p>
            <p class="mono">峰值弯矩 {{ result.tradeoffs[key as 'even' | 'weighted'].peakNm.toFixed(1) }}N·m ·
              {{ result.tradeoffs[key as 'even' | 'weighted'].pointCount }} 点 ·
              {{ result.tradeoffs[key as 'even' | 'weighted'].laborMinutes }} 分钟 ·
              配绳规格 {{ result.tradeoffs[key as 'even' | 'weighted'].ropeSpecKinds }} 种</p>
          </div>
        </div>
        <p class="conclude">
          取舍结论：当前采用「{{ result.tradeoffs[result.strategy].label }}」。被放弃的「{{ result.strategy === 'even' ? '按实际吊重分摊' : '按挂点等分' }}」
          峰值弯矩 {{ result.tradeoffs[result.strategy === 'even' ? 'weighted' : 'even'].peakNm.toFixed(1) }}N·m、工时
          {{ result.tradeoffs[result.strategy === 'even' ? 'weighted' : 'even'].laborMinutes }} 分钟 ——
          {{ result.strategy === 'even'
            ? `让出约 ${Math.max(0, Math.round((result.tradeoffs.weighted.pointCount - result.tradeoffs.even.pointCount) * 3))} 分钟现场工（孔位等距好挂），但各段弯矩差更大，需更粗杆料/更多加固件。`
            : `让出杆料（峰值弯矩更低，可用更细一档横杆，约省 ${Math.max(0, -result.tradeoffs.weighted.beamStockDeltaGPerM)}g/m），但每点吊法与绳索要逐点交代，现场多花约 ${result.tradeoffs.weighted.laborMinutes - result.tradeoffs.even.laborMinutes} 分钟。` }}
        </p>
      </section>

      <!-- 右：横杆图 + 结果 -->
      <section class="panel diagram">
        <div class="verdict" :class="result.allPass ? 'pass' : 'fail'">
          <b>{{ result.allPass ? '全杆合格' : '有 ' + result.checks.length + ' 段超档' }}</b>
          <span>最大利用率 {{ (utilMax * 100).toFixed(0) }}%（峰值 {{ result.globalPeakNm.toFixed(1) }}N·m / 容许 {{ result.segments[0]?.allowableNm.toFixed(1) }}N·m）</span>
        </div>
        <BeamDiagram :result="result" />
        <div class="balance mono">
          整杆平衡核对：支座反力和 {{ result.supports.reduce((s, x) => s + x.reactionN, 0).toFixed(1) }}N − 总载
          {{ result.totalLoadN.toFixed(1) }}N = {{ result.balanceDeltaN.toFixed(1) }}N；右端弯矩 {{ result.endMomentNm.toFixed(1) }}N·m（应≈0）；
          极值点 {{ result.globalPeakXMm }}mm 在挂点/支座处。
        </div>
        <p class="units">{{ result.unitsNote }}</p>
      </section>
    </div>

    <!-- 挂灯清单 -->
    <section class="panel">
      <h3>这一串挂灯（加一盏 / 挪一盏即整杆重算）</h3>
      <div class="addbar">
        <label>位置 <input v-model.number="draftX" type="number" min="0" :max="beam.lengthMm" step="10" /> mm</label>
        <label>盏数 <input v-model.number="draftQty" type="number" min="1" max="20" step="1" /></label>
        <button @click="addLanternAt()">加一盏「{{ lantern.name }}」</button>
        <select v-if="otherLanterns.length" @change="addAnotherLantern(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).selectedIndex = 0">
          <option value="">加另一种灯…</option>
          <option v-for="o in otherLanterns" :key="o.id" :value="o.id">{{ o.name }}（{{ coveringLabel(o.covering) }}）</option>
        </select>
        <button class="danger" @click="onClear">清空</button>
      </div>
      <table class="items">
        <thead>
          <tr><th>灯</th><th>蒙面</th><th class="num">单灯重(g)</th><th class="num">盏数</th><th>位置 (mm)</th><th class="num">小计重(kg)</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="it in result.items" :key="it.id">
            <td>{{ it.name }}</td>
            <td class="mono">{{ it.coveringName }} · {{ it.coveringM2 }}m²</td>
            <td class="num mono">{{ it.unitWeightG.toFixed(1) }}</td>
            <td class="num"><input :value="it.qty" type="number" min="1" max="20" @change="onQty(it.id, $event)" /></td>
            <td><input :value="it.desiredX" type="range" min="0" :max="beam.lengthMm" step="10" @input="onMove(it.id, $event)" />
              <span class="mono">{{ it.desiredX }}</span></td>
            <td class="num mono">{{ (it.unitWeightG * it.qty / 1000).toFixed(3) }}</td>
            <td><button class="danger mini" @click="onRemove(it.id)">删</button></td>
          </tr>
        </tbody>
      </table>
      <p class="hint">总挂重 <b>{{ result.totalLanternKg }}kg</b>（{{ result.groups.length }} 个挂点）。重量出处：{{ result.weightProvenance }}</p>
    </section>

    <!-- 挂点与段表 -->
    <div class="grid2">
      <section class="panel">
        <h3>每个挂点的拉力与配绳（逐点交代）</h3>
        <table class="pt">
          <thead><tr><th>挂点</th><th class="num">孔位(mm)</th><th class="num">盏</th><th class="num">重(kg)</th><th class="num">绳拉力(N)</th><th>吊法/配绳</th></tr></thead>
          <tbody>
            <tr v-for="g in result.groups" :key="g.id">
              <td><b>{{ g.id }}</b></td>
              <td class="num mono">{{ g.xMm }}</td>
              <td class="num mono">{{ g.lanternCount }}</td>
              <td class="num mono">{{ g.weightKg }}</td>
              <td class="num mono strong">{{ g.ropeTensionN.toFixed(1) }}</td>
              <td class="small">{{ g.riggingNote }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h3>横杆每段弯矩与安全档位</h3>
        <table class="pt">
          <thead><tr><th>段</th><th>区间</th><th class="num">mm</th><th class="num">峰值(N·m)</th><th class="num">容许</th><th class="num">利用率</th><th>判定</th></tr></thead>
          <tbody>
            <tr v-for="s in result.segments" :key="s.id" :class="{ over: !s.pass }">
              <td><b>{{ s.id }}</b></td>
              <td>{{ s.zone === 'left_overhang' ? '左挑' : s.zone === 'right_overhang' ? '右挑' : '跨内' }}</td>
              <td class="num mono">{{ s.fromX }}–{{ s.toX }}</td>
              <td class="num mono">{{ s.momentPeakNm.toFixed(1) }}</td>
              <td class="num mono">{{ s.allowableNm.toFixed(1) }}</td>
              <td class="num mono" :class="s.pass ? 'ok' : 'bad'">{{ (s.utilization * 100).toFixed(0) }}%</td>
              <td :class="s.pass ? 'ok' : 'bad'">{{ s.pass ? '合格' : '超档' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 超限点名与两条改法 -->
    <section v-if="result.checks.length" class="panel fixes">
      <h3>超档点名与两条改法（加挂点 / 把灯挪开）</h3>
      <div v-for="c in result.checks" :key="c.segmentId" class="fix-block">
        <p class="fix-seg">⚠ 段 <b>{{ c.segmentId }}</b>：峰值 {{ c.peakNm.toFixed(1) }}N·m ＞ 容许 {{ c.allowableNm.toFixed(1) }}N·m（{{ (c.utilization * 100).toFixed(0) }}%）</p>
        <div class="fix-cards">
          <div v-for="f in c.fixes" :key="f.kind" class="fix-card" :class="{ good: f.simulatedPass }">
            <h4>{{ f.title }} <em :class="f.simulatedPass ? 'ok' : 'bad'">{{ f.simulatedPass ? '模拟后合格' : '模拟后仍超' }}</em></h4>
            <p>{{ f.cost }}</p>
            <p>{{ f.tradeoff }}</p>
            <p class="mono small">模拟峰值利用率 {{ (f.simulatedPeakUtil * 100).toFixed(0) }}% · 模拟 {{ f.simulated.groups.length }} 孔</p>
            <button v-if="f.simulatedPass" @click="adoptFix(f.simulated)">采用此改法（旧孔位作废、整杆重算）</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 三处变化 -->
    <section class="panel changes">
      <h3>本次重算，三处各变了什么</h3>
      <div class="ch-grid">
        <div>
          <h4>参数与灯体预览页</h4>
          <ul><li v-for="(t, i) in result.changes.preview" :key="'p' + i">{{ t }}</li></ul>
        </div>
        <div>
          <h4>备料统计与材料页</h4>
          <ul><li v-for="(t, i) in result.changes.materials" :key="'m' + i">{{ t }}</li></ul>
        </div>
        <div>
          <h4>导出清单（受力表/备料单）</h4>
          <ul><li v-for="(t, i) in result.changes.exports" :key="'e' + i">{{ t }}</li></ul>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.hang { display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h2 { margin: 0 0 6px; font-size: 18px; color: #8f1c19; border-left: 4px solid var(--red); padding-left: 10px; }
.sub { margin: 0; font-size: 12.5px; color: var(--ink-soft); max-width: 900px; }
.ops { display: flex; gap: 8px; }
button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--surface-2); padding: 6px 12px; font-size: 12.5px; }
button:hover { border-color: var(--red); color: var(--red); }
button.primary { background: var(--red); border-color: var(--red); color: #fff; font-weight: 600; }
button.primary:hover { background: #9c1f1b; color: #fff; }
button.mini { padding: 3px 8px; font-size: 11.5px; }
button.danger { color: #8f1c19; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; box-shadow: var(--shadow); }
.panel h3 { margin: 4px 0 10px; font-size: 14px; color: #8f1c19; }
.row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
label { font-size: 12px; color: var(--ink-soft); display: flex; flex-direction: column; gap: 3px; }
input, select { font: inherit; font-size: 13px; padding: 4px 7px; border: 1px solid var(--line-strong); border-radius: 6px; background: #fff; }
.row input, .row select { width: 150px; }
.hint { font-size: 11.5px; color: var(--ink-soft); margin: 4px 0; }
.chk { flex-direction: row; align-items: center; gap: 6px; margin: 6px 0; }
.grid { display: grid; grid-template-columns: minmax(340px, 460px) 1fr; gap: 14px; align-items: start; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 1000px) { .grid, .grid2 { grid-template-columns: 1fr; } }
.strat { display: flex; gap: 8px; margin-bottom: 8px; }
.strat button.on { background: var(--red); border-color: var(--red); color: #fff; font-weight: 600; }
.trade { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.trade-card { border: 1px dashed var(--line-strong); border-radius: 8px; padding: 8px 10px; font-size: 12px; background: var(--surface-2); }
.trade-card.chosen { border-color: var(--red); border-style: solid; background: #fdf1ef; }
.trade-card h4 { margin: 0 0 4px; font-size: 12.5px; }
.trade-card p { margin: 3px 0; color: var(--ink-soft); }
.conclude { font-size: 12px; background: #f6e3ba33; border-left: 3px solid var(--gold); padding: 7px 10px; border-radius: 0 6px 6px 0; }
.verdict { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; }
.verdict.pass { background: #e8f3ee; color: #2f7a63; }
.verdict.fail { background: #fbeae6; color: #8f1c19; }
.balance { font-size: 11.5px; color: var(--ink-soft); background: var(--surface-2); padding: 7px 10px; border-radius: 6px; margin-top: 6px; }
.units { font-size: 11px; color: var(--ink-soft); margin: 6px 0 0; }
.addbar { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
.addbar label { flex-direction: column; }
.addbar input[type='number'] { width: 80px; }
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th { text-align: left; padding: 5px 8px; background: var(--surface-2); color: var(--ink-soft); font-weight: 500; font-size: 11.5px; border-bottom: 1px solid var(--line); }
td { padding: 4px 8px; border-bottom: 1px dashed var(--line); }
.num { text-align: right; }
.mono { font-family: var(--mono); }
.strong { font-weight: 700; color: #8f1c19; }
.small { font-size: 11.5px; color: var(--ink-soft); }
.ok { color: var(--jade); }
.bad { color: var(--red); }
.items input[type='number'] { width: 60px; }
.items input[type='range'] { width: 180px; vertical-align: middle; }
tr.over td { background: #fdf0ee; }
.rev { border-radius: 10px; padding: 10px 14px; border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow); }
.rev-main { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; }
.stale-tag { color: var(--red); font-weight: 600; }
.fresh-tag { color: var(--blue); }
.ok-tag { color: var(--jade); }
.rev.stale { border-color: var(--red); background: #fdf3f2; }
.rev-note { margin: 6px 0 0; font-size: 11.5px; color: var(--ink-soft); }
.fix-block { border-top: 1px dashed var(--line); padding-top: 10px; margin-top: 10px; }
.fix-seg { margin: 0 0 8px; font-size: 13px; }
.fix-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 900px) { .fix-cards { grid-template-columns: 1fr; } }
.fix-card { border: 1px solid var(--line-strong); border-radius: 8px; padding: 9px 11px; font-size: 12px; background: var(--surface-2); }
.fix-card.good { border-color: var(--jade); }
.fix-card h4 { margin: 0 0 5px; font-size: 12.5px; }
.fix-card p { margin: 4px 0; color: var(--ink-soft); }
.ch-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
@media (max-width: 1000px) { .ch-grid { grid-template-columns: 1fr; } }
.ch-grid h4 { margin: 0 0 6px; font-size: 12.5px; color: #8f1c19; }
.ch-grid ul { margin: 0; padding-left: 18px; font-size: 11.5px; color: var(--ink-soft); display: flex; flex-direction: column; gap: 4px; }
.missing { padding: 40px; text-align: center; }
</style>
