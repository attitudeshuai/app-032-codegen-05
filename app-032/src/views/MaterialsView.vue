<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern } from '../core/store'
import { computeAll } from '../core/checks'
import { DEFAULT_LOFT_OPTIONS } from '../core/paginate'
import { downloadText, materialsCsv, forceTableCsv } from '../core/exporter'
import { coveringSpec, CRAFT } from '../core/craft'
import { panelCutArea } from '../core/panels'
import { computeHanging, fM, fT, fX, fG } from '../core/hanging'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))
const full = computed(() => {
  const l = lantern.value
  if (!l) return null
  return computeAll(l, { ...DEFAULT_LOFT_OPTIONS, paper: l.pageSize, overlapMm: l.overlapMm })
})

/** 挂绳/吊环/加固件与受力表、预览页取同一份结果（同 digest） */
const hang = computed(() => (lantern.value ? computeHanging(lantern.value) : null))
const hangMaxM = computed(() => (hang.value ? Math.max(...hang.value.segments.map((s) => s.maxNodeMNmm)) : 0))

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
  downloadText(`${l.name}-备料单.csv`, materialsCsv(l, full.value.materials, full.value.batch, hang.value || undefined))
}

function exportForce() {
  const l = lantern.value
  if (!l || !hang.value) return
  downloadText(`${l.name}-横杆受力表.csv`, forceTableCsv(l, hang.value))
}
</script>

<template>
  <div v-if="!lantern || !full || !cov || !hang" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="materials">
    <section class="head">
      <div>
        <h2>材料统计与备料单 · {{ lantern.name }}</h2>
        <p class="sub">
          竹篾按<b>含绑扎余量</b>长度备料；蒙面按<b>含缝份</b>的裁片面积备料；
          批量总量 = 单灯 × 数量 × (1 + 损耗率)。
        </p>
      </div>
      <div class="ops">
        <button @click="exportForce">导出横杆受力表 CSV</button>
        <button @click="exportCsv">导出备料单 CSV</button>
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

    <!-- ============ 门廊横杆挂件（挂绳/吊环/加固件，与受力表同一份结果） ============ -->
    <section class="hang-block" :class="{ fail: !hang.pass }">
      <div class="hang-head">
        <h3>门廊横杆挂件备料 · 挂绳 / 吊环 / 加固件</h3>
        <router-link :to="`/hanging/${lantern.id}`" class="go">去挂点页布置 / 改法 →</router-link>
      </div>
      <p class="hang-note">
        单灯悬挂重量 <b>{{ fG(hang.weight.totalG) }}g（{{ fT(hang.weight.totalN) }}N）</b>
        全部取自本页上方的备料数：蒙面 {{ hang.weight.basis.coveringM2.toFixed(3) }}m²（含缝份）×
        {{ hang.weight.basis.coveringGM2 }}g/m²、骨架 {{ hang.weight.basis.frameM.toFixed(3) }}m（含绑扎余量）×
        {{ hang.weight.basis.frameGPerM }}g/m，<b>不按张数另估</b>。
        杆长 {{ fX(hang.setup.rodLengthMm) }}mm、{{ hang.setup.lightCount }} 盏、{{ hang.points.length }} 挂点、
        最大弯矩 {{ fM(hangMaxM) }}N·m；同源指纹 <span class="digest">{{ hang.digest }}</span>（与预览页、受力表一致）。
      </p>

      <div class="hang-tables">
        <table class="tally">
          <thead>
            <tr>
              <th>挂件项目</th>
              <th class="num">本杆备料</th>
              <th class="num">重量</th>
              <th>选型依据（同一挂点拉力）</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in hang.hardware.ropeLines" :key="r.spec.id">
              <td>挂绳 {{ r.spec.name }}</td>
              <td class="num mono strong">{{ r.lengthM.toFixed(2) }} m</td>
              <td class="num mono">{{ r.weightG }} g</td>
              <td class="small">许用 {{ r.spec.ratedN }}N，米数逐点累计（单股/双吊索各点不同，见挂点页）</td>
            </tr>
            <tr v-for="r in hang.hardware.ringLines" :key="r.spec.id">
              <td>吊环 {{ r.spec.name }}</td>
              <td class="num mono strong">{{ r.qty }} 个</td>
              <td class="num mono">{{ Math.round(r.spec.weightG * r.qty) }} g</td>
              <td class="small">许用 {{ r.spec.ratedN }}N；{{ r.qty }} 个含 2 个支座固定环</td>
            </tr>
            <tr>
              <td>加固件 钢套管（长100mm，含钉）</td>
              <td class="num mono strong">{{ hang.hardware.braceQty }} 件</td>
              <td class="num mono">{{ hang.hardware.braceTotalG }} g</td>
              <td class="small">应力利用 &gt;75% 的极值点（挂点处）各 1 件，150mm 内去重</td>
            </tr>
            <tr>
              <td>挂点孔 + 支座孔 / 现场估工</td>
              <td class="num mono strong">{{ hang.hardware.holeCount }} 个孔</td>
              <td class="num mono">—</td>
              <td class="small">打孔 {{ hang.hardware.holeCount * 4 }}min + 绑扎/装环，合计 {{ hang.hardware.laborMin }}min</td>
            </tr>
          </tbody>
        </table>

        <div class="hang-side">
          <div class="stat"><span>单灯悬挂重量</span><b>{{ fG(hang.weight.totalG) }} g</b></div>
          <div class="stat"><span>每点最大拉力</span><b>{{ fT(Math.max(...hang.points.map((p) => p.tensionN))) }} N</b></div>
          <div class="stat"><span>支座反力 A/B</span><b>{{ fT(hang.supports[0].reactionN) }} / {{ fT(hang.supports[1].reactionN) }} N</b></div>
          <div class="stat"><span>应力利用峰值</span><b :class="hang.pass ? 'ok' : 'bad'">{{ (hang.grade.maxStressRatio * 100).toFixed(0) }}%</b></div>
          <div class="stat"><span>挠度峰值 / 限值</span><b>{{ fT(hang.grade.maxDeflectionMm) }} / {{ fX(hang.grade.allowDeflectionMm) }} mm</b></div>
          <p class="rule" :class="{ badtext: !hang.pass }">
            {{ hang.pass ? '在「' + hang.grade.spec.name + '」档位内。' : '超出「' + hang.grade.spec.name + '」档位：' + (hang.grade.failingSegments.map((i) => '第' + i + '段').join('、') || '支座上拔') + '，到挂点页按「加挂点 / 把灯挪开」处理。' }}
          </p>
        </div>
      </div>

      <!-- 整杆重算：材料页变了哪几项 -->
      <div v-if="hang.change.materialChanges.length" class="hang-diff">
        <b>本次整杆重算，材料页变动项：</b>
        <ul>
          <li v-for="(x, i) in hang.change.materialChanges" :key="i">{{ x }}</li>
        </ul>
      </div>
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

.hang-block {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  padding: 12px 14px;
}

.hang-block.fail {
  border-color: #d8534a;
}

.hang-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
}

.hang-head h3 {
  margin: 0 0 6px;
  font-size: 14.5px;
  color: #8f1c19;
}

.hang-head .go {
  font-size: 12px;
}

.hang-note {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ink-soft);
  line-height: 1.7;
}

.hang-note .digest {
  font-family: var(--mono);
  font-size: 11px;
  color: #8a7a68;
}

.hang-tables {
  display: grid;
  grid-template-columns: 1fr minmax(250px, 320px);
  gap: 14px;
  align-items: start;
}

@media (max-width: 900px) {
  .hang-tables {
    grid-template-columns: 1fr;
  }
}

.hang-side .stat .ok {
  color: var(--jade);
}

.hang-side .stat .bad {
  color: var(--red);
}

.rule.badtext {
  color: #8f1c19;
}

.small {
  font-size: 11px;
  color: var(--ink-soft);
}

.hang-diff {
  margin-top: 10px;
  background: #f6f0e2;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
}

.hang-diff ul {
  margin: 4px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.missing {
  padding: 40px;
  text-align: center;
}
</style>
