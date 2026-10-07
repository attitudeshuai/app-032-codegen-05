<script setup lang="ts">
/**
 * 横杆受力示意图（预览页与挂点页共用）——
 * 所有标注（挂点位置、每点拉力、逐段弯矩、支座反力、加固件）均取自同一份
 * HangingResult；组件本身不做任何计算，保证三处图上数字一致。
 */
import { computed } from 'vue'
import type { HangingResult } from '../core/hanging'
import { fM, fT, fX } from '../core/hanging'

const props = withDefaults(
  defineProps<{
    result: HangingResult
    compact?: boolean
    showDigest?: boolean
  }>(),
  { compact: false, showDigest: true }
)

const VW = 1000
const MARGIN_L = 46
const MARGIN_R = 46
const ROD_Y = 118
const SCALE_W = VW - MARGIN_L - MARGIN_R

const sx = (xMm: number) => MARGIN_L + (xMm / props.result.setup.rodLengthMm) * SCALE_W

const ticks = computed(() => {
  const L = props.result.setup.rodLengthMm
  const step = L >= 2000 ? 500 : 200
  const out: number[] = []
  for (let x = 0; x <= L + 1; x += step) out.push(x)
  if (out[out.length - 1] !== L) out.push(L)
  return out
})

const maxM = computed(() => Math.max(1, ...props.result.segments.map((s) => Math.abs(s.maxNodeMNmm))))

function segColor(i: number): string {
  return props.result.grade.failingSegments.includes(i) ? '#b3241f' : '#2f7a63'
}

function segPath(i: number): string {
  const segs = props.result.segments
  const s = segs[i]
  const x0 = sx(s.fromMm)
  const x1 = sx(s.toMm)
  const h = 4 + 26 * (Math.abs(s.maxNodeMNmm) / maxM.value)
  const y = ROD_Y + 14 + h
  return `M${x0.toFixed(1)},${ROD_Y + 14} L${((x0 + x1) / 2).toFixed(1)},${y.toFixed(1)} L${x1.toFixed(1)},${ROD_Y + 14}`
}

const segLabelY = computed(() => ROD_Y + 14 + 4 + 26 + 12)
</script>

<template>
  <svg class="rod-svg" :viewBox="`0 0 ${VW} ${compact ? 190 : 232}`" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="横杆挂点与受力示意">
    <!-- 标尺 -->
    <g class="axis">
      <line :x1="MARGIN_L" :x2="VW - MARGIN_R" :y1="ROD_Y + 64" :y2="ROD_Y + 64" class="axis-line" />
      <g v-for="t in ticks" :key="t">
        <line :x1="sx(t)" :x2="sx(t)" :y1="ROD_Y + 61" :y2="ROD_Y + 67" class="axis-tick" />
        <text :x="sx(t)" :y="ROD_Y + 78" text-anchor="middle" class="axis-text">{{ fX(t) }}</text>
      </g>
      <text :x="(MARGIN_L + VW - MARGIN_R) / 2" :y="ROD_Y + 92" text-anchor="middle" class="axis-unit">
        横杆 {{ fX(result.setup.rodLengthMm) }}mm · 单位 mm（取整）
      </text>
    </g>

    <!-- 逐段弯矩（极值在端点的折线包络） -->
    <g class="moments">
      <path v-for="(s, i) in result.segments" :key="'m' + i" :d="segPath(i)" :stroke="segColor(s.index)" :class="['moment-line', { bad: result.grade.failingSegments.includes(s.index) }]" fill="none" />
      <g v-for="(s, i) in result.segments" :key="'ml' + i">
        <text
          :x="(sx(s.fromMm) + sx(s.toMm)) / 2"
          :y="ROD_Y + 14 + 4 + 26 * (Math.abs(s.maxNodeMNmm) / maxM) + 2"
          text-anchor="middle"
          :class="['moment-text', { bad: result.grade.failingSegments.includes(s.index) }]"
        >
          {{ fM(s.maxNodeMNmm) }}
        </text>
        <text v-if="!compact" :x="(sx(s.fromMm) + sx(s.toMm)) / 2" :y="segLabelY" text-anchor="middle" class="moment-unit">
          段{{ s.index }} N·m{{ s.braced ? ' · 加固' : '' }}
        </text>
      </g>
    </g>

    <!-- 横杆 -->
    <rect :x="MARGIN_L" :y="ROD_Y - 4" :width="SCALE_W" height="8" rx="2" class="rod" />

    <!-- 加固件 -->
    <g v-for="(b, i) in result.hardware.bracePositionsMm" :key="'b' + i">
      <rect :x="sx(b) - 7" :y="ROD_Y - 8" width="14" height="16" rx="2" class="brace" />
    </g>

    <!-- 挑出端标注 -->
    <text :x="(MARGIN_L + sx(result.supports[0].xMm)) / 2" :y="ROD_Y - 12" text-anchor="middle" class="overhang-text">
      左挑出 {{ fX(result.setup.leftSupportMm) }}
    </text>
    <text :x="(sx(result.supports[1].xMm) + VW - MARGIN_R) / 2" :y="ROD_Y - 12" text-anchor="middle" class="overhang-text">
      右挑出 {{ fX(result.setup.rightSupportMm) }}
    </text>

    <!-- 挂点与灯 -->
    <g v-for="p in result.points" :key="p.id">
      <line :x1="sx(p.xMm)" :x2="sx(p.xMm)" :y1="ROD_Y + 4" :y2="ROD_Y + 40" class="sling" :class="{ double: p.doubleSling }" />
      <g v-if="p.doubleSling">
        <line :x1="sx(p.xMm) - 7" :x2="sx(p.xMm)" :y1="ROD_Y + 40" :y2="ROD_Y + 4" class="sling double" />
        <line :x1="sx(p.xMm) + 7" :x2="sx(p.xMm)" :y1="ROD_Y + 40" :y2="ROD_Y + 4" class="sling double" />
      </g>
      <ellipse :cx="sx(p.xMm)" :cy="ROD_Y + 46" rx="13" ry="8" class="lamp" />
      <text :x="sx(p.xMm)" :y="ROD_Y + 49" text-anchor="middle" class="lamp-qty">×{{ p.qty }}</text>
      <!-- 拉力标注 -->
      <g>
        <rect :x="sx(p.xMm) - 30" :y="ROD_Y - 42" width="60" :height="compact ? 22 : 30" rx="4" class="tag" />
        <text :x="sx(p.xMm)" :y="ROD_Y - 28" text-anchor="middle" class="tag-text">{{ fT(p.tensionN) }}N</text>
        <text v-if="!compact" :x="sx(p.xMm)" :y="ROD_Y - 16" text-anchor="middle" class="tag-sub">
          {{ p.id }} · x={{ fX(p.xMm) }}{{ p.doubleSling ? ' · 双索' : '' }}
        </text>
      </g>
    </g>

    <!-- 支座 -->
    <g v-for="s in result.supports" :key="s.id">
      <polygon :points="`${sx(s.xMm)},${ROD_Y + 6} ${sx(s.xMm) - 12},${ROD_Y + 26} ${sx(s.xMm) + 12},${ROD_Y + 26}`" class="support" :class="{ uplift: s.uplift }" />
      <text :x="sx(s.xMm)" :y="ROD_Y + 38" text-anchor="middle" class="support-label">
        {{ s.id }} {{ fT(s.reactionN) }}N
      </text>
      <text :x="sx(s.xMm)" :y="ROD_Y + 50" text-anchor="middle" class="support-sub">{{ s.uplift ? '上拔！' : '下压' }}</text>
    </g>

    <text v-if="showDigest" :x="VW - MARGIN_R" y="14" text-anchor="end" class="digest">
      受力指纹 {{ result.digest }} · 与材料页/导出同源 · 拉力 N（1 位小数）· 弯矩 N·m（2 位小数）
    </text>
  </svg>
</template>

<style scoped>
.rod-svg {
  width: 100%;
  height: auto;
  display: block;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.rod {
  fill: #8a6a3f;
  stroke: #5f492b;
  stroke-width: 0.6;
}

.brace {
  fill: rgba(80, 90, 110, 0.35);
  stroke: #45505f;
  stroke-width: 0.6;
}

.sling {
  stroke: #6a5c52;
  stroke-width: 1;
}
.sling.double {
  stroke: #2f5f8a;
}

.lamp {
  fill: rgba(179, 36, 31, 0.18);
  stroke: #b3241f;
  stroke-width: 1;
}
.lamp-qty {
  font-size: 9px;
  fill: #8f1c19;
  font-weight: 700;
}

.tag {
  fill: #fbeae6;
  stroke: #d8534a;
  stroke-width: 0.6;
}
.tag-text {
  font-size: 11px;
  font-weight: 700;
  fill: #8f1c19;
}
.tag-sub {
  font-size: 8px;
  fill: #6a5c52;
}

.support {
  fill: #45505f;
}
.support.uplift {
  fill: #b3241f;
}
.support-label {
  font-size: 9.5px;
  font-weight: 700;
  fill: #2b2320;
}
.support-sub {
  font-size: 8px;
  fill: #6a5c52;
}

.overhang-text {
  font-size: 9px;
  fill: #6a5c52;
}

.moment-line {
  stroke-width: 1.2;
}
.moment-line.bad {
  stroke-width: 1.8;
}
.moment-text {
  font-size: 9px;
  fill: #2f7a63;
  font-weight: 700;
}
.moment-text.bad {
  fill: #b3241f;
}
.moment-unit {
  font-size: 7.5px;
  fill: #6a5c52;
}

.axis-line {
  stroke: #c6b49b;
  stroke-width: 0.8;
}
.axis-tick {
  stroke: #c6b49b;
  stroke-width: 0.8;
}
.axis-text {
  font-size: 8px;
  fill: #6a5c52;
}
.axis-unit {
  font-size: 8px;
  fill: #8a7a68;
}

.digest {
  font-size: 8px;
  fill: #8a7a68;
}
</style>
