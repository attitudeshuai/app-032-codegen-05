<script setup lang="ts">
/**
 * 挂点布置与受力核定页
 *  - 灯重直接读 computeHanging()（蒙面按含缝份面积×面密度、骨架按备料长度×线密度）；
 *  - 两种分摊法（按挂点等分 / 按实际吊重分摊）都解算，选一条并写清另一条的代价；
 *  - 超档点名到段，给「加挂点 / 把灯挪开」两条改法与各自代价；
 *  - 「确认采用」=已按本版在横杆上打孔并存档；输入一改，旧版分组/判定/配绳/已导出表
 *    全部作废，孔位按 ±3mm 借位规则列出重开清单；
 *  - 三处各自变了什么（预览标注 / 材料页吊挂件米数 / 清单行）逐项列出。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import RodDiagram from '../components/RodDiagram.vue'
import ChecksPanel from '../components/ChecksPanel.vue'
import { getLantern } from '../core/store'
import {
  HANGING_CATALOG,
  gradeSpec,
  rodSpec
} from '../core/craft'
import {
  commitHanging,
  computeHanging,
  defaultHangingSetup,
  fM,
  fS,
  fT,
  fX,
  fG,
  markForceExported,
  placeByLoad
} from '../core/hanging'
import { downloadText, forceTableCsv } from '../core/exporter'
import type { HangingStrategyId, SafetyGradeId } from '../core/types'

const route = useRoute()
const router = useRouter()
const lantern = computed(() => getLantern(route.params.id as string))

function ensure(): NonNullable<NonNullable<ReturnType<typeof getLantern>>['hanging']> {
  const l = lantern.value!
  if (!l.hanging) l.hanging = defaultHangingSetup(l)
  return l.hanging
}

const h = computed(() => (lantern.value ? computeHanging(lantern.value) : null))

function patch(p: Partial<ReturnType<typeof ensure>>) {
  Object.assign(ensure(), p)
}

function setStrategy(s: HangingStrategyId) {
  const setup = ensure()
  if (s === 'load' && setup.groups.length < 2) {
    // 首次切到按吊重法：自动均布一次（之后手动挪灯不再被覆盖）
    const placed = placeByLoad(lantern.value!, setup)
    setup.groups = placed.groups
  }
  setup.strategy = s
}

function rerunLoadLayout() {
  const setup = ensure()
  const placed = placeByLoad(lantern.value!, setup)
  setup.groups = placed.groups
  setup.strategy = 'load'
}

function setGrade(g: SafetyGradeId) {
  patch({ grade: g })
}

/** load 模式下逐点编辑后同步总灯数（computeHanging 也会再算一遍，这里保证输入显示一致） */
function syncLightCount() {
  const setup = ensure()
  setup.lightCount = (setup.groups || []).reduce((s, g) => s + Math.max(1, Math.round(g.qty) || 1), 0)
}

function addGroup() {
  const setup = ensure()
  setup.strategy = 'load'
  const groups = [...(setup.groups || [])]
  const x = groups.length ? Math.min(setup.rodLengthMm - 40, groups[groups.length - 1].xMm + 120) : setup.leftSupportMm + 400
  groups.push({ id: 'D' + String(groups.length + 1).padStart(2, '0'), xMm: x, qty: 1 })
  patch({ groups, lightCount: groups.reduce((s, g) => s + g.qty, 0) })
}

function removeGroup(i: number) {
  const setup = ensure()
  const groups = (setup.groups || []).filter((_, k) => k !== i)
  if (groups.length < 2) return
  patch({ groups, lightCount: groups.reduce((s, g) => s + g.qty, 0) })
}

function applyFix(which: 'add-point' | 'move-lamp') {
  const l = lantern.value!
  const fx = h.value!.fixes.find((f) => f.id === which)
  if (!fx) return
  l.hanging = { ...fx.nextSetup, commit: l.hanging?.commit || null }
}

function adopt() {
  const l = lantern.value!
  commitHanging(l, h.value!)
}

function exportForce() {
  const l = lantern.value!
  const result = h.value!
  downloadText(`${l.name}-横杆受力表.csv`, forceTableCsv(l, result))
  markForceExported(l, result)
}

const commitTime = computed(() => {
  const c = h.value?.setup.commit
  return c ? new Date(c.committedAt).toLocaleString() : ''
})

const failingSegText = computed(() =>
  (h.value?.grade.failingSegments || [])
    .map((i) => {
      const s = h.value!.segments[i - 1]
      return `第${i}段(${fX(s.fromMm)}–${fX(s.toMm)}mm，${fM(s.maxNodeMNmm)}N·m)`
    })
    .join('、')
)
</script>

<template>
  <div v-if="!lantern || !h" class="missing">找不到该灯样。<router-link to="/">返回</router-link></div>
  <div v-else class="hang">
    <section class="head">
      <div>
        <h2>挂点布置与受力核定 · {{ lantern.name }}</h2>
        <p class="sub">
          灯重直接取蒙面裁片（含缝份面积）与备料单（含余量长度）已算好的数，乘同一份材料清单的单位重量；
          重量先按克、力按牛（g=9.80665），千克仅换算展示。长度 mm 取整、拉力 1 位小数、弯矩 N·m 2 位小数。
        </p>
      </div>
      <div class="ops">
        <button @click="exportForce">导出受力表 CSV</button>
        <button class="primary" @click="adopt">确认采用（按本版打孔并存档）</button>
      </div>
    </section>

    <!-- 旧版作废横幅 -->
    <section v-if="h.change.hasCommit && !h.change.valid" class="banner bad">
      <b>⚠ 旧版受力结果已整体作废，需重算并重开挂点孔。</b>
      <ul>
        <li v-for="(r, i) in h.change.reasons" :key="i">{{ r }}</li>
      </ul>
      <div class="holes">
        <span>旧孔 {{ h.change.holes.oldHolesMm.map(fX).join('、') }}mm；</span>
        <span class="ok">可借位（±3mm）：{{ h.change.holes.reusedMm.map(fX).join('、') || '无' }}；</span>
        <span class="bad">必须重开：{{ h.change.holes.reopenMm.map(fX).join('、') || '无' }}mm；</span>
        <span>新增孔：{{ h.change.holes.addedMm.map(fX).join('、') || '无' }}mm。</span>
      </div>
      <div v-if="h.change.exportStale" class="stale">已导出的旧受力表指纹与现版不符，旧表作废，请重新导出。</div>
    </section>
    <section v-else-if="h.change.hasCommit && h.change.valid" class="banner ok">
      当前结果与本机存档一致（{{ commitTime }} 打孔）{{ h.setup.commit?.exportedDigest ? '，受力表已导出' : '，尚未导受力表' }}；
      改蒙面材料、加灯或挪灯都会使该存档连同孔位、分组、安全余量判定与配绳长度一起失效。
    </section>

    <div class="layout">
      <!-- 左：参数 -->
      <section class="params">
        <h3>横杆与支座</h3>
        <div class="row">
          <div class="field">
            <label>横杆总长 (mm)</label>
            <input v-model.number="ensure().rodLengthMm" type="number" min="400" max="8000" step="10" />
          </div>
          <div class="field">
            <label>绳下垂净空 (mm)</label>
            <input v-model.number="ensure().dropMm" type="number" min="50" max="2000" step="10" />
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label>左挑出端 (mm)</label>
            <input v-model.number="ensure().leftSupportMm" type="number" min="0" step="10" />
          </div>
          <div class="field">
            <label>右挑出端 (mm)</label>
            <input v-model.number="ensure().rightSupportMm" type="number" min="0" step="10" />
          </div>
        </div>
        <div class="field">
          <label>横杆材料</label>
          <select v-model="ensure().rodId">
            <option v-for="r in HANGING_CATALOG.rods" :key="r.id" :value="r.id">
              {{ r.name }}（{{ r.bendAllowMPa }}MPa / {{ r.pricePerM }} 元每米）
            </option>
          </select>
          <small>{{ rodSpec(h.setup.rodId).note }}</small>
        </div>
        <div class="field">
          <label>安全档位（写明的标准）</label>
          <select :value="h.setup.grade" @change="setGrade(($event.target as HTMLSelectElement).value as SafetyGradeId)">
            <option v-for="g in HANGING_CATALOG.grades" :key="g.id" :value="g.id">{{ g.name }}</option>
          </select>
          <small>
            {{ gradeSpec(h.setup.grade).note }}；本杆许用应力 {{ fS(rodSpec(h.setup.rodId).bendAllowMPa) }}MPa ×
            {{ gradeSpec(h.setup.grade).stressRatio }} = {{ fS(h.grade.limitStressMPa) }}MPa，挠度限值
            {{ fX(h.grade.allowDeflectionMm) }}mm（跨/{{ gradeSpec(h.setup.grade).deflectionRatio }}）。
          </small>
        </div>

        <h3>受力怎么分摊（二选一）</h3>
        <div class="strategy">
          <button :class="{ on: h.setup.strategy === 'equal' }" @click="setStrategy('equal')">
            按挂点等分
            <small>布置简单、现场好挂；各段弯矩差得多</small>
          </button>
          <button :class="{ on: h.setup.strategy === 'load' }" @click="setStrategy('load')">
            按实际吊重分摊
            <small>各段更均匀、杆更省；吊法绳索逐点交代</small>
          </button>
        </div>
        <p class="trade" :class="{ pick: true }">
          <b>本版代价：</b>{{ h.tradeoff.chosenCostText }}
        </p>
        <p class="trade yield"><b>被放弃的「{{ h.tradeoff.rejected.name }}」让出了什么：</b>{{ h.tradeoff.rejectedYieldText }}</p>
        <table class="cmp">
          <thead>
            <tr><th></th><th>按挂点等分</th><th>按实际吊重分摊</th></tr>
          </thead>
          <tbody>
            <tr><td>挂点数</td><td :class="{ sel: h.tradeoff.chosen.id === 'equal' }">{{ h.tradeoff.chosen.id === 'equal' ? h.tradeoff.chosen.pointCount : h.tradeoff.rejected.pointCount }}</td><td :class="{ sel: h.tradeoff.chosen.id === 'load' }">{{ h.tradeoff.chosen.id === 'load' ? h.tradeoff.chosen.pointCount : h.tradeoff.rejected.pointCount }}</td></tr>
            <tr><td>最大弯矩 (N·m)</td><td :class="{ sel: h.tradeoff.chosen.id === 'equal' }">{{ (h.tradeoff.chosen.id === 'equal' ? h.tradeoff.chosen.maxMNm : h.tradeoff.rejected.maxMNm).toFixed(2) }}</td><td :class="{ sel: h.tradeoff.chosen.id === 'load' }">{{ (h.tradeoff.chosen.id === 'load' ? h.tradeoff.chosen.maxMNm : h.tradeoff.rejected.maxMNm).toFixed(2) }}</td></tr>
            <tr><td>应力利用</td><td :class="{ sel: h.tradeoff.chosen.id === 'equal' }">{{ ((h.tradeoff.chosen.id === 'equal' ? h.tradeoff.chosen.maxStressRatio : h.tradeoff.rejected.maxStressRatio) * 100).toFixed(0) }}%</td><td :class="{ sel: h.tradeoff.chosen.id === 'load' }">{{ ((h.tradeoff.chosen.id === 'load' ? h.tradeoff.chosen.maxStressRatio : h.tradeoff.rejected.maxStressRatio) * 100).toFixed(0) }}%</td></tr>
            <tr><td>挂绳 (m)</td><td :class="{ sel: h.tradeoff.chosen.id === 'equal' }">{{ (h.tradeoff.chosen.id === 'equal' ? h.tradeoff.chosen.ropeTotalM : h.tradeoff.rejected.ropeTotalM).toFixed(2) }}</td><td :class="{ sel: h.tradeoff.chosen.id === 'load' }">{{ (h.tradeoff.chosen.id === 'load' ? h.tradeoff.chosen.ropeTotalM : h.tradeoff.rejected.ropeTotalM).toFixed(2) }}</td></tr>
            <tr><td>现场工时 (min)</td><td :class="{ sel: h.tradeoff.chosen.id === 'equal' }">{{ h.tradeoff.chosen.id === 'equal' ? h.tradeoff.chosen.laborMin : h.tradeoff.rejected.laborMin }}</td><td :class="{ sel: h.tradeoff.chosen.id === 'load' }">{{ h.tradeoff.chosen.id === 'load' ? h.tradeoff.chosen.laborMin : h.tradeoff.rejected.laborMin }}</td></tr>
            <tr><td>过档杆料</td><td :class="{ sel: h.tradeoff.chosen.id === 'equal' }">{{ (h.tradeoff.chosen.id === 'equal' ? h.tradeoff.chosen.rodNeeded : h.tradeoff.rejected.rodNeeded)?.name || '现有杆都不过' }}</td><td :class="{ sel: h.tradeoff.chosen.id === 'load' }">{{ (h.tradeoff.chosen.id === 'load' ? h.tradeoff.chosen.rodNeeded : h.tradeoff.rejected.rodNeeded)?.name || '现有杆都不过' }}</td></tr>
          </tbody>
        </table>

        <!-- 等分法参数 -->
        <div v-if="h.setup.strategy === 'equal'" class="sub-params">
          <div class="row">
            <div class="field">
              <label>这一串共几盏</label>
              <input v-model.number="ensure().lightCount" type="number" min="1" max="200" step="1" />
            </div>
            <div class="field">
              <label>挂几个点</label>
              <input v-model.number="ensure().equalPointCount" type="number" min="2" max="12" step="1" />
            </div>
          </div>
          <small>净跨内 {{ h.setup.equalPointCount }} 点等分（{{ h.setup.equalPointCount + 1 }} 个等距空档），灯按轮发分到点，相邻点灯数差 ≤1。</small>
        </div>

        <!-- 按吊重法逐点编辑 -->
        <div v-else class="sub-params">
          <div class="grp-head">
            <h4>逐点交代（位置 mm / 几盏）</h4>
            <div class="grp-btns">
              <button class="mini" @click="rerunLoadLayout">自动均布</button>
              <button class="mini" @click="addGroup">＋ 加一点</button>
            </div>
          </div>
          <table class="groups">
            <tbody>
              <tr v-for="(g, i) in ensure().groups" :key="g.id">
                <td class="mono">{{ g.id }}</td>
                <td><input v-model.number="g.xMm" type="number" min="40" :max="h.setup.rodLengthMm - 40" step="5" /></td>
                <td><input v-model.number="g.qty" type="number" min="1" max="40" step="1" @change="syncLightCount" /></td>
                <td><button class="mini danger" :disabled="ensure().groups.length <= 2" @click="removeGroup(i)">删</button></td>
              </tr>
            </tbody>
          </table>
          <small>合计 {{ h.setup.lightCount }} 盏；改完位置即整杆重算，每点的吊法（单股/双吊索）、绳长与吊环逐点出在下表。</small>
        </div>
      </section>

      <!-- 右：结果 -->
      <section class="results">
        <div class="verdict" :class="h.pass ? 'pass' : 'fail'">
          <div class="v-main">
            <b>{{ h.pass ? '✔ 受力核定通过' : '✖ 超出「' + h.grade.spec.name + '」档位' }}</b>
            <span>
              单灯 {{ fG(h.weight.totalG) }}g（{{ fT(h.weight.totalN) }}N）× {{ h.setup.lightCount }} 盏；最大弯矩
              {{ fM(Math.max(...h.segments.map((s) => s.maxNodeMNmm))) }}N·m；应力利用峰值
              {{ (h.grade.maxStressRatio * 100).toFixed(0) }}%；挠度峰值 {{ fT(h.grade.maxDeflectionMm) }}mm / 限值
              {{ fX(h.grade.allowDeflectionMm) }}mm
            </span>
          </div>
        </div>

        <RodDiagram :result="h" />

        <!-- 超档点名 + 两条改法 -->
        <div v-if="h && !h.pass" class="fixes">
          <h3>超档点名与两条改法</h3>
          <p class="fail-segs">
            超档位段：<b>{{ failingSegText || '无（应力段未超，见下方支座上拔提示）' }}</b>
            <b v-if="h.grade.upliftSupports.length" class="uplift">；支座 {{ h.grade.upliftSupports.join('、') }} 反力为负（挑出端压过跨内，需压重或锚固）</b>
          </p>
          <div class="fix-grid">
            <div v-for="fx in h.fixes" :key="fx.id" class="fix-card" :class="{ good: fx.pass }">
              <h4>{{ fx.title }}</h4>
              <p class="action">{{ fx.action }}</p>
              <p class="proj">改后最大弯矩 {{ fM(fx.projectedMaxMNm * 1000) }}N·m，应力利用 {{ (fx.projectedMaxStressRatio * 100).toFixed(0) }}%{{ fx.pass ? '（过档）' : '（仍不过档，需叠加另一改法）' }}</p>
              <p class="cost">{{ fx.tradeoff }}</p>
              <button @click="applyFix(fx.id)">应用这条改法（整杆重算）</button>
            </div>
          </div>
        </div>

        <!-- 挂点表 -->
        <h3>各挂点拉力与吊法</h3>
        <table class="data">
          <thead>
            <tr>
              <th>挂点</th><th class="num">位置 (mm)</th><th class="num">灯数</th><th class="num">灯重拉力 (N)</th>
              <th class="num">挂点拉力 (N)</th><th class="num">折合 kg</th><th>吊法/绳/环</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in h.points" :key="p.id">
              <td class="mono">{{ p.id }}</td>
              <td class="num mono">{{ fX(p.xMm) }}</td>
              <td class="num mono">{{ p.qty }}</td>
              <td class="num mono">{{ fT(p.lampsN) }}</td>
              <td class="num mono strong">{{ fT(p.tensionN) }}</td>
              <td class="num mono">{{ p.tensionKg.toFixed(2) }}</td>
              <td class="small">{{ p.note }}；{{ p.rope.name }}（许用 {{ p.rope.ratedN }}N）{{ p.ropeLengthM.toFixed(2) }}m；{{ p.ring.name }}（许用 {{ p.ring.ratedN }}N）</td>
            </tr>
          </tbody>
        </table>

        <!-- 分段表 -->
        <h3>横杆逐段弯矩 / 应力 / 挠度（逐段累加，极值在挂点或支座）</h3>
        <table class="data">
          <thead>
            <tr>
              <th>段</th><th class="num">起 (mm)</th><th class="num">止 (mm)</th><th>部位</th>
              <th class="num">弯矩 (N·m)</th><th class="num">极值位置</th><th class="num">整杆核对 (N·m)</th>
              <th class="num">应力 (MPa)</th><th class="num">挠度 (mm)</th><th>加固</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in h.segments" :key="s.index" :class="{ badrow: h.grade.failingSegments.includes(s.index) }">
              <td class="mono">{{ s.index }}</td>
              <td class="num mono">{{ fX(s.fromMm) }}</td>
              <td class="num mono">{{ fX(s.toMm) }}</td>
              <td>{{ s.kind === 'span' ? '跨间' : s.kind === 'left-overhang' ? '左挑出端' : '右挑出端' }}</td>
              <td class="num mono strong">{{ fM(s.maxNodeMNmm) }}</td>
              <td class="num mono">{{ fX(s.maxAtMm) }}</td>
              <td class="num mono dim">{{ fM(s.maxExactMNmm) }}</td>
              <td class="num mono">{{ fS(s.stressMPa) }}</td>
              <td class="num mono">{{ fT(s.deflectionMm) }}</td>
              <td>{{ s.braced ? '钢套管' : '—' }}</td>
            </tr>
          </tbody>
        </table>

        <!-- 挂件备料 -->
        <h3>挂绳 / 吊环 / 加固件还要备多少（材料页与备料单同此数）</h3>
        <table class="data">
          <tbody>
            <tr v-for="r in h.hardware.ropeLines" :key="r.spec.id">
              <td>挂绳 {{ r.spec.name }}（许用 {{ r.spec.ratedN }}N）</td>
              <td class="num mono strong">{{ r.lengthM.toFixed(2) }} m</td>
              <td class="num mono">{{ r.weightG }} g</td>
            </tr>
            <tr v-for="r in h.hardware.ringLines" :key="r.spec.id">
              <td>吊环 {{ r.spec.name }}（许用 {{ r.spec.ratedN }}N，含 2 个支座固定环）</td>
              <td class="num mono strong">{{ r.qty }} 个</td>
              <td class="num mono">{{ Math.round(r.spec.weightG * r.qty) }} g</td>
            </tr>
            <tr>
              <td>加固件 钢套管（长 100mm，含钉）</td>
              <td class="num mono strong">{{ h.hardware.braceQty }} 件</td>
              <td class="num mono">{{ h.hardware.braceTotalG }} g</td>
            </tr>
            <tr>
              <td>挂点孔 + 支座孔合计 / 现场估工</td>
              <td class="num mono strong">{{ h.hardware.holeCount }} 个孔</td>
              <td class="num mono">{{ h.hardware.laborMin }} min</td>
            </tr>
          </tbody>
        </table>

        <!-- 整杆重算：三处变更 -->
        <h3>整杆重算 · 三处各自变了什么</h3>
        <div class="changes">
          <div class="ch-col">
            <h5>① 参数与灯体预览页</h5>
            <ul><li v-for="(x, i) in h.change.previewChanges" :key="'p' + i">{{ x }}</li></ul>
          </div>
          <div class="ch-col">
            <h5>② 备料统计与材料页</h5>
            <ul><li v-for="(x, i) in h.change.materialChanges" :key="'m' + i">{{ x }}</li></ul>
          </div>
          <div class="ch-col">
            <h5>③ 导出清单（受力表/备料单）</h5>
            <ul><li v-for="(x, i) in h.change.exportChanges" :key="'e' + i">{{ x }}</li></ul>
          </div>
        </div>

        <ChecksPanel :checks="h.checks" title="受力核定自检（CHK-H1 ~ H6）" />
        <div class="links">
          <router-link :to="`/design/${lantern.id}`">去参数与灯体预览页看同一根杆</router-link>
          <router-link :to="`/materials/${lantern.id}`">去材料页看挂件备料</router-link>
          <button @click="router.push(`/print/${lantern.id}?view=frame`)">打印清单</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hang { display: flex; flex-direction: column; gap: 14px; }
h2 { margin: 0 0 6px; font-size: 18px; color: #8f1c19; border-left: 4px solid var(--red); padding-left: 10px; }
.sub { margin: 0; font-size: 12.5px; color: var(--ink-soft); max-width: 980px; }
.head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.ops { display: flex; gap: 8px; }
button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--line-strong); background: var(--surface-2); padding: 6px 12px; font-size: 12.5px; }
button:hover { border-color: var(--red); color: var(--red); }
button.primary { background: var(--red); border-color: var(--red); color: #fff; font-weight: 600; }
button.mini { padding: 2px 8px; font-size: 11.5px; }
button.danger { color: #b3241f; }
button:disabled { opacity: 0.4; cursor: not-allowed; }

.banner { border-radius: 10px; padding: 10px 14px; font-size: 12.5px; }
.banner.bad { background: #fbeae6; border: 1px solid #d8534a; color: #8f1c19; }
.banner.ok { background: #e9f4ef; border: 1px solid #2f7a63; color: #1f5243; }
.banner ul { margin: 6px 0 6px 18px; padding: 0; }
.holes { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; font-family: var(--mono); font-size: 12px; }
.holes .ok { color: #1f5243; }
.holes .bad { color: #b3241f; font-weight: 700; }
.stale { margin-top: 6px; font-weight: 700; }

.layout { display: grid; grid-template-columns: 340px 1fr; gap: 14px; align-items: start; }
@media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } }

.params, .results { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--shadow); padding: 12px 14px; }
.params h3 { margin: 14px 0 8px; font-size: 13px; color: #8f1c19; }
.params h4 { margin: 0; font-size: 12.5px; }
.row { display: flex; gap: 10px; margin-bottom: 8px; }
.field { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; margin-bottom: 8px; }
label { font-size: 12px; color: var(--ink-soft); }
input, select { font: inherit; font-size: 12.5px; padding: 4px 7px; border: 1px solid var(--line-strong); border-radius: 6px; background: #fff; width: 100%; font-family: var(--mono); }
small { font-size: 11px; color: var(--ink-soft); }

.strategy { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.strategy button { text-align: left; padding: 8px; font-weight: 700; font-size: 12.5px; display: flex; flex-direction: column; gap: 3px; }
.strategy button small { font-weight: 400; }
.strategy button.on { background: var(--red); border-color: var(--red); color: #fff; }
.strategy button.on small { color: #ffe9e7; }

.trade { font-size: 11.5px; color: var(--ink-soft); background: var(--surface-2); border-radius: 8px; padding: 7px 9px; margin: 8px 0; }
.trade.yield { background: #f6f0e2; }
.cmp { width: 100%; border-collapse: collapse; font-size: 11.5px; margin-bottom: 6px; }
.cmp th, .cmp td { border: 1px solid var(--line); padding: 3px 6px; text-align: center; }
.cmp th { background: var(--surface-2); color: var(--ink-soft); font-weight: 500; }
.cmp td:first-child { text-align: left; color: var(--ink-soft); }
.cmp td.sel { background: #fbeae6; font-weight: 700; color: #8f1c19; }

.sub-params { border-top: 1px dashed var(--line); padding-top: 8px; }
.grp-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.grp-btns { display: flex; gap: 6px; }
.groups { width: 100%; border-collapse: collapse; }
.groups td { padding: 2px 3px; }
.groups input { padding: 3px 5px; }

.verdict { border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; }
.verdict.pass { background: #e9f4ef; border: 1px solid #2f7a63; }
.verdict.fail { background: #fbeae6; border: 1px solid #d8534a; }
.v-main { display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
.v-main b { font-size: 14.5px; }
.verdict.pass b { color: #1f5243; }
.verdict.fail b { color: #8f1c19; }
.v-main span { font-size: 12px; color: var(--ink-soft); }

.fixes { border: 1px solid #d8534a; border-radius: 10px; padding: 10px 12px; margin: 10px 0; background: #fff8f7; }
.fixes h3 { margin: 0 0 6px; color: #8f1c19; font-size: 14px; }
.fail-segs { margin: 0 0 8px; font-size: 12.5px; }
.fail-segs .uplift { color: #b3241f; }
.fix-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 900px) { .fix-grid { grid-template-columns: 1fr; } }
.fix-card { border: 1px solid var(--line-strong); border-radius: 8px; padding: 9px 11px; background: #fff; display: flex; flex-direction: column; gap: 6px; }
.fix-card.good { border-color: #2f7a63; }
.fix-card h4 { margin: 0; font-size: 13px; color: #8f1c19; }
.fix-card p { margin: 0; font-size: 12px; }
.fix-card .proj { color: #1f5243; }
.fix-card .cost { color: var(--ink-soft); background: var(--surface-2); border-radius: 6px; padding: 6px 8px; }

h3 { font-size: 14px; margin: 14px 0 6px; color: #2b2320; }
.data { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
.data th { text-align: left; padding: 5px 7px; background: var(--surface-2); color: var(--ink-soft); font-weight: 500; border-bottom: 1px solid var(--line); font-size: 11.5px; }
.data td { padding: 4px 7px; border-bottom: 1px dashed var(--line); }
.num { text-align: right; }
.mono { font-family: var(--mono); }
.strong { font-weight: 700; color: #8f1c19; }
.dim { color: var(--ink-soft); }
.small { font-size: 11px; color: var(--ink-soft); }
tr.badrow td { background: #fdecea; }

.changes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
@media (max-width: 1100px) { .changes { grid-template-columns: 1fr; } }
.ch-col { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: var(--surface-2); }
.ch-col h5 { margin: 0 0 6px; font-size: 12px; color: #8f1c19; }
.ch-col ul { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 4px; }
.ch-col li { font-size: 11.5px; color: var(--ink-soft); }

.links { display: flex; gap: 14px; align-items: center; margin-top: 10px; font-size: 12.5px; flex-wrap: wrap; }
.missing { padding: 40px; text-align: center; }
</style>
