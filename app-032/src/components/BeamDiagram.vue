<script setup lang="ts">
/**
 * 横杆挂点与受力图（参数预览页 / 挂点布置页共用，取数只认 HangingResult）
 * 画：杆端与挑出端、两个支座（反力向上）、挂点（拉力向下，标注编号/N）、
 * 每段弯矩极值（超限段红色点名）、以及下方弯矩包络示意。
 * 视图为示意比例（非 1:1），所有数值标签直接取受力结果的同一字段。
 */
import { computed } from 'vue'
import type { HangingResult } from '../core/hanging'

const props = defineProps<{
  result: HangingResult
  height?: number
}>()

const W = 1080
const MARGIN = { l: 56, r: 36, t: 70, b: 40 }
const MOMENT_H = 150

const totalH = computed(() => (props.height || 420))
const beamY = computed(() => MARGIN.t + 40)
const plotW = computed(() => W - MARGIN.l - MARGIN.r)

const xOf = (xMm: number) => MARGIN.l + (xMm / props.result.beam.lengthMm) * plotW.value

const beam = computed(() => {
  const r = props.result
  return {
    x0: xOf(0),
    x1: xOf(r.beam.lengthMm),
    sA: xOf(r.beam.leftSupportMm),
    sB: xOf(r.beam.rightSupportMm)
  }
})

const hangers = computed(() =>
  props.result.groups.map((g) => ({
    ...g,
    x: xOf(g.xMm)
  }))
)

const supports = computed(() =>
  props.result.supports.map((s) => ({ ...s, x: xOf(s.xMm) }))
)

/** 弯矩包络折线：每段两端弯矩（按比例缩放，正负上下分） */
const momentPath = computed(() => {
  const r = props.result
  const peak = Math.max(1, ...r.segments.map((s) => Math.max(Math.abs(s.momentStartNm), Math.abs(s.momentEndNm))))
  const baseY = beamY.value + 96
  const scale = MOMENT_H / peak
  const pts = [
    { x: beam.value.x0, y: baseY },
    ...r.segments.map((s) => ({ x: xOf(s.toX), y: baseY - s.momentEndNm * scale }))
  ]
  return {
    line: pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' '),
    baseY,
    peak
  }
})
</script>

<template>
  <svg class="beam-svg" :viewBox="`0 0 ${W} ${totalH}`" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <marker id="arrow-down" markerWidth="8" markerHeight="8" refX="4" refY="7" orient="auto">
        <path d="M0,0 L4,7 L8,0 Z" fill="#b3241f" />
      </marker>
      <marker id="arrow-up" markerWidth="8" markerHeight="8" refX="4" refY="1" orient="auto">
        <path d="M0,7 L4,0 L8,7 Z" fill="#2f7a63" />
      </marker>
    </defs>

    <!-- 挑出端底纹 -->
    <rect :x="beam.x0" :y="beamY - 9" :width="beam.sA - beam.x0" height="18" fill="rgba(184,137,31,0.10)" />
    <rect :x="beam.sB" :y="beamY - 9" :width="beam.x1 - beam.sB" height="18" fill="rgba(184,137,31,0.10)" />

    <!-- 横杆 -->
    <line :x1="beam.x0" :x2="beam.x1" :y1="beamY" :y2="beamY" stroke="#5a4632" stroke-width="7" stroke-linecap="round" />
    <text :x="beam.x0" :y="beamY - 16" class="dim">杆端 0mm</text>
    <text :x="beam.x1" :y="beamY - 16" text-anchor="end" class="dim">{{ result.beam.lengthMm }}mm</text>

    <!-- 挑出端标注 -->
    <text :x="(beam.x0 + beam.sA) / 2" :y="beamY + 26" text-anchor="middle" class="zone">左挑出端 {{ result.beam.leftSupportMm }}mm</text>
    <text :x="(beam.sB + beam.x1) / 2" :y="beamY + 26" text-anchor="middle" class="zone">右挑出端 {{ result.beam.lengthMm - result.beam.rightSupportMm }}mm</text>

    <!-- 挂点：拉力向下 -->
    <g v-for="g in hangers" :key="g.id">
      <line :x1="g.x" :x2="g.x" :y1="beamY - 52" :y2="beamY - 6" stroke="#b3241f" stroke-width="2" marker-end="url(#arrow-down)" />
      <circle :cx="g.x" :cy="beamY" r="4.5" :fill="g.ropeTensionN > 0 ? '#b3241f' : '#999'" />
      <text :x="g.x" :y="beamY - 58" text-anchor="middle" class="hp">{{ g.id }} · {{ g.ropeTensionN.toFixed(1) }}N</text>
      <text :x="g.x" :y="beamY + 44" text-anchor="middle" class="hsub">@{{ g.xMm }}mm · {{ g.lanternCount }}盏 · {{ g.weightKg }}kg</text>
    </g>

    <!-- 支座：反力向上 -->
    <g v-for="s in supports" :key="s.id">
      <line :x1="s.x" :x2="s.x" :y1="beamY + 40" :y2="beamY + 6" stroke="#2f7a63" stroke-width="2.4" marker-end="url(#arrow-up)" />
      <polygon :points="`${s.x - 9},${beamY + 52} ${s.x + 9},${beamY + 52} ${s.x},${beamY + 38}`" fill="#2f7a63" />
      <text :x="s.x" :y="beamY + 68" text-anchor="middle" class="rp">{{ s.id }} 反力 {{ s.reactionN.toFixed(1) }}N（{{ s.reactionKg.toFixed(2) }}kg）</text>
    </g>

    <!-- 分段弯矩着色与点名 -->
    <g v-for="seg in result.segments" :key="seg.id">
      <line
        :x1="xOf(seg.fromX)" :x2="xOf(seg.toX)" :y1="beamY + 84" :y2="beamY + 84"
        :stroke="seg.pass ? '#2f7a63' : '#b3241f'"
        :stroke-width="seg.pass ? 3 : 5"
        :stroke-dasharray="seg.zone === 'span' ? '0' : '4 3'"
      />
      <text
        :x="(xOf(seg.fromX) + xOf(seg.toX)) / 2" :y="beamY + 80" text-anchor="middle"
        :class="seg.pass ? 'mok' : 'mover'"
      >
        {{ seg.id }} {{ seg.momentPeakNm.toFixed(1) }}N·m
      </text>
    </g>

    <!-- 弯矩包络 -->
    <line :x1="beam.x0" :x2="beam.x1" :y1="momentPath.baseY" :y2="momentPath.baseY" stroke="#c6b49b" stroke-width="1" />
    <path :d="momentPath.line" fill="none" stroke="#2f5f8a" stroke-width="1.6" />
    <text :x="beam.x1" :y="momentPath.baseY - 4" text-anchor="end" class="dim">弯矩包络（N·m，示意比例）</text>
    <text :x="MARGIN.l" :y="momentPath.baseY + 16" class="dim">
      极值 {{ result.globalPeakNm.toFixed(1) }}N·m @{{ result.globalPeakXMm }}mm（落在挂点/支座处）· 容许 {{ result.segments[0]?.allowableNm.toFixed(1) }}N·m
    </text>

    <!-- 图例 -->
    <g class="legend" :transform="`translate(${MARGIN.l},18)`">
      <text x="0" y="0" class="dim">
        {{ result.strategy === 'even' ? '按挂点等分' : '按实际吊重分摊' }} · 第 {{ result.revision }} 版 ·
        安全档「{{ result.tier.name }}」×{{ result.tier.factor }} · {{ result.section.name }}
      </text>
      <text x="0" y="18" class="dim">
        红=挂点拉力（N，1位小数） 绿=支座反力 下方每段：{{ ' ' }}
        <tspan fill="#2f7a63">绿=合格</tspan> / <tspan fill="#b3241f">红=超档点名</tspan>（挑出端点纹 / 跨内实线）
      </text>
    </g>
  </svg>
</template>

<style scoped>
.beam-svg {
  width: 100%;
  height: auto;
  display: block;
}
.dim {
  font-size: 11px;
  fill: #6a5c52;
}
.zone {
  font-size: 10.5px;
  fill: #8a6a2a;
}
.hp {
  font-size: 11.5px;
  font-weight: 700;
  fill: #b3241f;
}
.hsub {
  font-size: 10px;
  fill: #6a5c52;
}
.rp {
  font-size: 11px;
  font-weight: 600;
  fill: #2f7a63;
}
.mok {
  font-size: 10px;
  fill: #2f7a63;
}
.mover {
  font-size: 10.5px;
  font-weight: 700;
  fill: #b3241f;
}
</style>
