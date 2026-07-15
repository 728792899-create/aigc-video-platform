export type DurationRange = [number, number]
export type DurationPresetValue = '1m' | '3m' | '5m' | '10m' | '30m' | '60m' | 'custom'
export type DetailLevel = 'concise' | 'standard' | 'rich'

export interface DurationPresetOption {
  label: string
  value: DurationPresetValue
  range: DurationRange | null
  target: number | null
}

export const DURATION_PRESET_OPTIONS: DurationPresetOption[] = [
  { label: '1 分钟', value: '1m', range: [45, 75], target: 60 },
  { label: '3 分钟', value: '3m', range: [150, 210], target: 180 },
  { label: '5 分钟', value: '5m', range: [240, 360], target: 300 },
  { label: '10 分钟', value: '10m', range: [540, 660], target: 600 },
  { label: '30 分钟', value: '30m', range: [1680, 1920], target: 1800 },
  { label: '60 分钟', value: '60m', range: [3420, 3780], target: 3600 },
  { label: '自定义', value: 'custom', range: null, target: null },
]

export const DEFAULT_DURATION_PRESET: DurationPresetValue = '3m'
export const DEFAULT_DURATION_RANGE: DurationRange = [150, 210]
export const CUSTOM_DURATION_RANGE: DurationRange = [30, 7200]

const DETAIL_DENSITY: Record<DetailLevel, DurationRange> = {
  concise: [2.5, 3.5],
  standard: [3.5, 5],
  rich: [5, 6.5],
}

function cloneRange(range: DurationRange): DurationRange {
  return [range[0], range[1]]
}

export function rangeForPreset(
  value: string,
  fallback: DurationRange = DEFAULT_DURATION_RANGE,
): DurationRange {
  const preset = DURATION_PRESET_OPTIONS.find((item) => item.value === value)
  return cloneRange(preset?.range ?? fallback)
}

export function inferDurationPreset(range: unknown): DurationPresetValue {
  if (!Array.isArray(range) || range.length < 2) return DEFAULT_DURATION_PRESET
  const min = Number(range[0])
  const max = Number(range[1])
  const preset = DURATION_PRESET_OPTIONS.find((item) => item.range?.[0] === min && item.range[1] === max)
  return preset?.value ?? 'custom'
}

export function normalizeDurationRange(
  value: unknown,
  fallback: DurationRange = DEFAULT_DURATION_RANGE,
): DurationRange {
  if (Array.isArray(value) && value.length >= 2) {
    const min = Number(value[0])
    const max = Number(value[1])
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) return [min, max]
  }
  if (typeof value === 'string') {
    const numbers = value.match(/\d+(\.\d+)?/g)?.map(Number).filter((number) => Number.isFinite(number) && number > 0) ?? []
    if (numbers.length >= 2) return [Math.min(...numbers), Math.max(...numbers)]
  }
  return cloneRange(fallback)
}

export function formatDuration(seconds: unknown): string {
  const value = Math.max(0, Math.round(Number(seconds) || 0))
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = value % 60
  if (hours > 0) {
    if (minutes === 0 && secs === 0) return `${hours}小时`
    if (secs === 0) return `${hours}小时${minutes}分钟`
    return `${hours}小时${minutes}分${secs}秒`
  }
  if (minutes > 0) {
    if (secs === 0) return `${minutes}分钟`
    return `${minutes}分${secs}秒`
  }
  return `${value}秒`
}

export function formatDurationRange(range: unknown): string {
  const [min, max] = normalizeDurationRange(range)
  return `${formatDuration(min)} - ${formatDuration(max)}`
}

export function durationPayload(range: unknown): string {
  const [min, max] = normalizeDurationRange(range)
  return `${Math.round(min)}-${Math.round(max)}`
}

export function targetDurationSec(range: unknown): number {
  const [min, max] = normalizeDurationRange(range)
  return Math.round((min + max) / 2)
}

export function isLongDurationRange(range: unknown): boolean {
  const [, max] = normalizeDurationRange(range)
  return max >= 600
}

export function sliderMaxForDuration(range: unknown, preset = ''): number {
  return preset === 'custom' || isLongDurationRange(range) ? CUSTOM_DURATION_RANGE[1] : 300
}

export function sliderStepForDuration(range: unknown, preset = ''): number {
  return preset === 'custom' || isLongDurationRange(range) ? 60 : 5
}

export function estimateSceneSeconds(range: unknown): number {
  const target = targetDurationSec(range)
  if (target >= 600) return 30
  if (target >= 150) return 12
  if (target >= 90) return 10
  return 8
}

function roundToFive(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5)
}

function isDetailLevel(value: string): value is DetailLevel {
  return value === 'concise' || value === 'standard' || value === 'rich'
}

export function detailWordRange(detailLevel: string, range: unknown): DurationRange {
  const density = isDetailLevel(detailLevel) ? DETAIL_DENSITY[detailLevel] : DETAIL_DENSITY.standard
  const sceneSeconds = estimateSceneSeconds(range)
  return [roundToFive(density[0] * sceneSeconds), roundToFive(density[1] * sceneSeconds)]
}

export function detailOptionLabel(label: string, detailLevel: string, range: unknown): string {
  const [min, max] = detailWordRange(detailLevel, range)
  return `${label}（约${min}-${max}字/镜）`
}
