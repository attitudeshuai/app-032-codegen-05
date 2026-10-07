<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern, state as lanternState } from '../core/store'
import { ensureState } from '../core/hangingStore'
import { computeHanging } from '../core/hanging'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { downloadText, forceTableCsv, materialsCsv, riggingCsv } from '../core/exporter'
import { coveringSpec, CRAFT } from '../core/craft'
import { panelCutArea } from '../core/panels'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})

/** 挂点受力同一份结果（与预览页、挂点页、导出同源），材料页据此算挂绳/吊环/加固件备多少 */
const hanging = computed(() => {
  const l = lantern.value
  if (!l) return null
  const s = ensureState(l.id, l)
  return computeHanging(
    l,
    s.beam,
    s.strategy,
    s.items,
    (id) => lanternState.lanterns.find((x) => x.id === id)
  )
})

const cov = computed(() => (lantern.value ? coveringSpec(lantern.value.covering) : null))

const layerFabric = computed(() => {
  const l = lantern.value
  if (!l || !full.value) return []
  return l.layers.map((ly, i) => {
    const ps = full.value!.panels.panels.filter((p) => p.layerIndex === i)
    const area = ps.reduce((s, p) => s + panelCutArea(p) * p.qty, 0)
    return {
      i: i + 1,
      color: l.layerColors[i] || l.color,
      height: ly.heightMm,
      diameter: ly.diameterMm,
      kinds: ps.length,
      perPiece: ps.length ? panelCutArea(ps[0]) : 0,
      qty: ps.reduce((s, p) => s + p.qty, 0),
      areaM2: area / 1e6
    }
  })
})

function exportCsv() {
  const l = lantern.value
  if (!l || !full.value) return
  downloadText(`${l.name}-备料单.csv`, materialsCsv(l, full.value.materials, full.value.batch))
}
function exportForce() {
  const l = lantern.value
  if (!l || !hanging.value) return
  downloadText(`${l.name}-受力表-第${hanging.value.revision}版.csv`, forceTableCsv(l, hanging.value))
}
function exportRigging() {
  const l = lantern.value
  if (!l || !hanging.value) return
  downloadText(`${l.name}-挂装备料单-第${hanging.value.revision}版.csv`, riggingCsv(l, hanging.value))
}
</script>

<template>
  <div v-if="!lantern || !full || !cov || !hanging" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="materials">
    <section class="head">
      <div>
        <h2>材料统计与备料单 · {{ lantern.name }}</h2>
        <p class="sub">
          竹篾按<b>含绑扎余量</b>长度备料；蒙面按<b>含缝份</b>的裁片面积备料；
          批量总量 = 单灯 × 数量 × (1 + 损耗率)。
          挂绳/吊环/加固件按<b>第 {{ hanging.revision }} 版受力结果</b>备料，与预览页、挂点页、导出清单同源同数。
        </p>
      </div>
      <div class="ops">
        <button @click="exportCsv">导出备料单 CSV</button>
        <button @click="exportForce">导出受力表 CSV</button>
        <button @click="exportRigging">导出挂装备料单 CSV</button>
        <button class="primary" @click="router.push(`/print/${lantern.id}?view=frame`)">打印备料 / 清单</button>
      </div>
    </section>

    <section class="batch">
      <div class="field">
        <label>批量数量（个）</label>
        <input v-model.number="lantern.batchCount" type="number" min="1" max="500" step="1" />
      </div>
      <div class="field">
        <label>损耗率 <em>{{ (lantern.wasteRatio * 100).toFixed(0) }}%</em></label>
        <input v-model.number="lantern.wasteRatio" type="range" min="0" max="0.2" step="0.01" />
      </div>
      <p class="formula mono">
        批量 = 单灯 × {{ Math.max(1, Math.round(lantern.batchCount)) }} × {{ (1 + lantern.wasteRatio).toFixed(2) }}
      </p>
    </section>

    <section class="tables">
      <table class="tally">
        <thead>
          <tr>
            <th>项目</th>
            <th class="num">单灯</th>
            <th class="num">批量 {{ full.batch.count }} 个（含损耗）</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>竹篾 / 铁丝（含绑扎余量）</td>
            <td class="num mono">{{ full.materials.frameM.toFixed(3) }} m</td>
            <td class="num mono strong">{{ full.batch.frameM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>构件净长合计</td>
            <td class="num mono">{{ full.materials.frameRawM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.frameRawM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>蒙面 {{ cov.name }}（含缝份）</td>
            <td class="num mono">{{ full.materials.coveringM2.toFixed(3) }} m²</td>
            <td class="num mono strong">{{ full.batch.coveringM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>蒙面净面积（不含缝份）</td>
            <td class="num mono">{{ full.materials.coveringNetM2.toFixed(3) }} m²</td>
            <td class="num mono">{{ full.batch.coveringNetM2.toFixed(3) }} m²</td>
          </tr>
          <tr>
            <td>扎线（{{ full.materials.lashJoints }} 处绑扎 × {{ CRAFT.lashPerJointM }}m/处）</td>
            <td class="num mono">{{ full.materials.lashM.toFixed(3) }} m</td>
            <td class="num mono">{{ full.batch.lashM.toFixed(3) }} m</td>
          </tr>
          <tr>
            <td>胶（{{ cov.name }} {{ cov.gluePerM2 }}g/m²）</td>
            <td class="num mono">{{ full.materials.glueG.toFixed(1) }} g</td>
            <td class="num mono">{{ full.batch.glueG.toFixed(1) }} g</td>
          </tr>
          <tr class="led">
            <td>LED 灯珠建议</td>
            <td class="num mono">{{ full.materials.ledCount }} 颗</td>
            <td class="num mono">{{ full.batch.ledCount }} 颗</td>
          </tr>
          <tr class="weight">
            <td>骨架重（备料 {{ full.materials.frameM }}m × {{ CRAFT.frameWeightGPerM }}g/m）</td>
            <td class="num mono">{{ full.materials.frameWeightG.toFixed(1) }} g</td>
            <td class="num mono">{{ full.batch.frameWeightG.toFixed(1) }} g</td>
          </tr>
          <tr class="weight">
            <td>蒙面重（{{ full.materials.coveringM2 }}m² × {{ cov.name }} {{ cov.areaWeightGPerM2 }}g/m²，按面积非张数）</td>
            <td class="num mono">{{ full.materials.coveringWeightG.toFixed(1) }} g</td>
            <td class="num mono">{{ full.batch.coveringWeightG.toFixed(1) }} g</td>
          </tr>
          <tr class="weight">
            <td>扎线 / 胶 / LED / 电池 / 顶部五金</td>
            <td class="num mono">{{
              (full.materials.lashWeightG + full.materials.glueWeightG + full.materials.ledWeightG + full.materials.batteryWeightG + full.materials.hardwareWeightG).toFixed(1) }} g</td>
            <td class="num mono">{{
              (full.batch.lashWeightG + full.batch.glueWeightG + full.batch.ledWeightG + full.batch.batteryWeightG + full.batch.hardwareWeightG).toFixed(1) }} g</td>
          </tr>
          <tr class="weight totalw">
            <td>单灯总重（受力核定只取此数，三处同源）</td>
            <td class="num mono strong">{{ full.materials.totalWeightG.toFixed(1) }} g ＝ {{ full.materials.totalWeightKg.toFixed(3) }} kg</td>
            <td class="num mono strong">{{ full.batch.totalWeightG.toFixed(1) }} g</td>
          </tr>
        </tbody>
      </table>

      <div class="side">
        <div class="stat"><span>灯体体积</span><b>{{ full.materials.volumeL.toFixed(3) }} L</b></div>
        <div class="stat"><span>灯体表面积</span><b>{{ full.materials.surfaceM2.toFixed(3) }} m²</b></div>
        <div class="stat"><span>构件总根数</span><b>{{ full.frame.totalQty }}</b></div>
        <div class="stat"><span>裁片总块数</span><b>{{ full.panels.totalQty }}</b></div>
        <p class="rule">LED 建议规则：{{ CRAFT.led.rule }}</p>
      </div>
    </section>

    <section class="palette">
      <h3>分层蒙面用量（按层买布/买纸用）</h3>
      <table>
        <thead>
          <tr>
            <th>层</th>
            <th>颜色</th>
            <th class="num">分段高 (mm)</th>
            <th class="num">该层直径 (mm)</th>
            <th class="num">裁片种类</th>
            <th class="num">每块面积 (m²)</th>
            <th class="num">块数</th>
            <th class="num">合计面积 (m²)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in layerFabric" :key="r.i">
            <td class="mono">第 {{ r.i }} 层</td>
            <td>
              <span class="dot" :style="{ background: r.color }" />
              <span class="mono">{{ r.color }}</span>
            </td>
            <td class="num mono">{{ r.height.toFixed(1) }}</td>
            <td class="num mono">{{ r.diameter.toFixed(1) }}</td>
            <td class="num mono">{{ r.kinds }}</td>
            <td class="num mono">{{ (r.perPiece / 1e6).toFixed(4) }}</td>
            <td class="num mono">{{ r.qty }}</td>
            <td class="num mono">{{ r.areaM2.toFixed(3) }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="rigging">
      <div class="rg-head">
        <h3>挂绳 / 吊环 / 加固件备料（取自第 {{ hanging.revision }} 版受力结果，与预览页/导出同一份）</h3>
        <router-link :to="`/hanging/${lantern.id}`" class="rg-link">去挂点页调整 →</router-link>
      </div>
      <p class="rg-verdict" :class="hanging.allPass ? 'pass' : 'fail'">
        {{ hanging.allPass ? '全杆合格，无需加固件' : hanging.checks.length + ' 段超档，需加固件 ' + hanging.rigging.stiffenerCount + ' 件（或按受力表改法加挂点/挪灯后清零）' }}
      </p>
      <table>
        <thead>
          <tr>
            <th>项目</th>
            <th class="num">净用量</th>
            <th class="num">含损耗备料</th>
            <th>单位 / 说明</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>挂点孔位</td><td class="num mono">{{ hanging.rigging.pointCount }}</td><td class="num mono">{{ hanging.rigging.pointCount }}</td><td>个 · 孔位随版本作废重开</td></tr>
          <tr><td>挂绳</td><td class="num mono">{{ hanging.rigging.ropeRawM.toFixed(3) }}</td><td class="num mono strong">{{ hanging.rigging.ropeM.toFixed(3) }}</td><td>m · 逐点长度见受力表，含 8% 损耗</td></tr>
          <tr><td>吊环</td><td class="num mono">{{ hanging.rigging.ringCount }}</td><td class="num mono strong">{{ Math.ceil(hanging.rigging.ringCount * 1.05) }}</td><td>只 · 直吊 1/点、斜吊 2/点，含 5% 损耗</td></tr>
          <tr><td>支座固定夹</td><td class="num mono">{{ hanging.rigging.clampCount }}</td><td class="num mono">{{ Math.ceil(hanging.rigging.clampCount * 1.05) }}</td><td>副 · 每支座 1 副</td></tr>
          <tr :class="{ over: hanging.rigging.stiffenerCount > 0 }">
            <td>加固件</td><td class="num mono">{{ hanging.rigging.stiffenerCount }}</td><td class="num mono">{{ Math.ceil(hanging.rigging.stiffenerCount * 1.05) }}</td>
            <td>件 · {{ hanging.rigging.stiffenerCount ? '用于 ' + hanging.rigging.stiffenerSegmentIds.join('、') : '本版不需要' }}</td>
          </tr>
          <tr><td>横杆备料（{{ hanging.section.name }}）</td><td class="num mono">{{ (hanging.rigging.beamStockMm / 1000).toFixed(3) }}</td><td class="num mono">{{ (hanging.rigging.beamStockMm / 1000).toFixed(3) }}</td><td>m · 一整根，自重 {{ hanging.rigging.beamWeightKg }}kg</td></tr>
          <tr><td>挂装五金合计重</td><td class="num mono">{{ hanging.rigging.totalRiggingWeightG.toFixed(1) }}</td><td class="num mono">{{ hanging.rigging.totalRiggingWeightG.toFixed(1) }}</td><td>g</td></tr>
        </tbody>
      </table>
      <ul class="rg-changes">
        <li v-for="(t, i) in hanging.changes.materials" :key="i">本页变化：{{ t }}</li>
      </ul>
    </section>

    <ChecksPanel :checks="full.checks" :elapsed-ms="full.elapsedMs" title="全量验收自检（§10）" />
  </div>
</template>

<style scoped>
.materials {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
}

h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: #8f1c19;
  border-left: 4px solid var(--red);
  padding-left: 10px;
}

.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  max-width: 900px;
}

.ops {
  display: flex;
  gap: 8px;
}

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface-2);
  padding: 6px 12px;
  font-size: 12.5px;
}

button:hover {
  border-color: var(--red);
  color: var(--red);
}

button.primary {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  font-weight: 600;
}

button.primary:hover {
  background: #9c1f1b;
  color: #fff;
}

.batch {
  display: flex;
  gap: 24px;
  align-items: flex-end;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
}

label {
  font-size: 12px;
  color: var(--ink-soft);
}

label em {
  font-style: normal;
  font-family: var(--mono);
  color: var(--blue);
}

input[type='number'] {
  font: inherit;
  font-size: 13px;
  padding: 5px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  width: 120px;
  font-family: var(--mono);
}

input[type='range'] {
  width: 180px;
  accent-color: var(--red);
}

.formula {
  margin: 0 0 4px auto;
  font-size: 13px;
  color: #8f1c19;
  background: #fbeae6;
  padding: 5px 12px;
  border-radius: 6px;
}

.tables {
  display: grid;
  grid-template-columns: 1fr minmax(240px, 300px);
  gap: 16px;
  align-items: start;
}

@media (max-width: 900px) {
  .tables {
    grid-template-columns: 1fr;
  }
}

.tally,
.palette table {
  width: 100%;
  border-collapse: collapse;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  font-size: 13px;
  box-shadow: var(--shadow);
}

.tally th,
.palette th {
  text-align: left;
  padding: 8px 14px;
  background: var(--surface-2);
  color: var(--ink-soft);
  font-weight: 500;
  font-size: 11.5px;
  border-bottom: 1px solid var(--line);
}

.tally td,
.palette td {
  padding: 8px 14px;
  border-bottom: 1px dashed var(--line);
}

.tally tr:last-child td,
.palette tr:last-child td {
  border-bottom: none;
}

tr.led td {
  background: #fff9ec;
}

tr.weight td {
  background: #f4f8f6;
  font-size: 12px;
}

tr.totalw td {
  background: #e8f3ee;
}

.rigging {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 16px;
  box-shadow: var(--shadow);
}

.rg-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.rigging h3 {
  margin: 0 0 6px;
  font-size: 14px;
}

.rg-link {
  font-size: 12px;
  white-space: nowrap;
}

.rg-verdict {
  margin: 0 0 8px;
  font-size: 12.5px;
  font-weight: 600;
}

.rg-verdict.pass {
  color: var(--jade);
}

.rg-verdict.fail {
  color: var(--red);
}

.rigging tr.over td {
  background: #fdf0ee;
}

.rg-changes {
  margin: 8px 0 0;
  padding-left: 18px;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.num {
  text-align: right;
}

.mono {
  font-family: var(--mono);
}

.strong {
  font-weight: 700;
  color: #8f1c19;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.stat {
  background: var(--surface);
  padding: 9px 14px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.stat span {
  font-size: 11.5px;
  color: var(--ink-soft);
}

.stat b {
  font-family: var(--mono);
  font-size: 14px;
}

.rule {
  margin: 0;
  background: var(--surface);
  padding: 10px 14px;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.palette {
  box-shadow: var(--shadow);
  border-radius: 10px;
}

.palette h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  margin-right: 5px;
  border: 1px solid var(--line-strong);
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
