import crypto from 'node:crypto'
import { z } from 'zod'

export const SCRIPT_SCHEMA_VERSION = '1.0.0';
export const SCRIPT_PROMPT_VERSION = 'script-2026-07-14.1';

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isJsonObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

const optionalText = (max: number) => z.string().max(max).optional().default('');
const stringList = z.array(z.string().max(1000)).max(200).optional().default([]);

const sourceRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).refine((range: { start: number; end: number }) => range.end >= range.start, {
  message: 'end 必须大于或等于 start',
  path: ['end'],
});

const characterInSceneSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: optionalText(120),
  action: optionalText(1000),
  emotion: optionalText(300),
  location: optionalText(500),
  wardrobe: optionalText(500),
  state_note: optionalText(1000),
});

const storyboardSchema = z.object({
  id: z.number().int().positive().optional(),
  scene_number: z.number().int().positive(),
  description: z.string().trim().min(1, '分镜缺少画面描述').max(12000),
  dialog: optionalText(20000),
  action: optionalText(4000),
  duration: z.number().positive().max(600),
  prompt: optionalText(12000),
  video_prompt: optionalText(12000),
  negative_prompt: optionalText(8000),
  source_range: sourceRangeSchema.optional(),
  chapter: z.number().int().positive().optional(),
  chapter_index: z.number().int().positive().optional().default(1),
  chapter_title: optionalText(500),
  subtitle_text: optionalText(20000),
  subtitle_style: z.unknown().optional(),
  transition: optionalText(120),
  voice: optionalText(200),
  motion: optionalText(500),
  no_voice: z.boolean().optional().default(false),
  characters_in_scene: z.array(characterInSceneSchema).max(100).optional().default([]),
  continuity_notes: optionalText(4000),
  scene_state_before: optionalText(4000),
  scene_state_after: optionalText(4000),
});

const characterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: optionalText(120),
  age: optionalText(120),
  gender: optionalText(120),
  face: optionalText(2000),
  hair: optionalText(2000),
  clothing: optionalText(2000),
  signature_props: optionalText(2000),
  personality: optionalText(2000),
  voice: optionalText(1000),
  prompt_anchor: optionalText(8000),
  negative_constraints: optionalText(8000),
  is_primary: z.boolean().optional().default(false),
});

const storyBibleSchema = z.object({
  worldview: optionalText(12000),
  mainline: optionalText(12000),
  timeline: stringList,
  open_threads: stringList,
  locked_facts: stringList,
  relationships: stringList,
  scene_rules: optionalText(12000),
}).optional().default({
  worldview: '',
  mainline: '',
  timeline: [],
  open_threads: [],
  locked_facts: [],
  relationships: [],
  scene_rules: '',
});

const chapterSchema = z.object({
  chapter_index: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  summary: optionalText(4000),
  target_duration_sec: z.number().nonnegative().max(86400).optional().default(0),
});

export const structuredScriptSchema = z.object({
  schema_version: z.literal(SCRIPT_SCHEMA_VERSION),
  prompt_version: z.literal(SCRIPT_PROMPT_VERSION),
  input_hash: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.string().trim().min(2).max(40),
  style: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  summary: optionalText(12000),
  total_duration: z.number().nonnegative().max(86400),
  visual_anchor: optionalText(12000),
  story_bible: storyBibleSchema,
  characters: z.array(characterSchema).max(200).optional().default([]),
  chapters: z.array(chapterSchema).max(500).optional().default([]),
  storyboards: z.array(storyboardSchema).min(1, '至少需要一个有效分镜').max(5000),
  long_video_mode: z.boolean().optional().default(false),
  narration_stats: z.unknown().optional(),
  quality_warnings: z.array(z.string().max(2000)).max(200).optional().default([]),
  _demo: z.unknown().optional(),
  _long_scaffold: z.unknown().optional(),
});

interface ContractIssue {
  path: string
  code: string
  message: string
}

export class ScriptContractError extends Error {
  readonly code = 'SCRIPT_OUTPUT_INVALID'
  readonly retryable = true
  readonly diagnosticRef: string
  readonly issues: ContractIssue[]

  constructor(issues: z.ZodIssue[], outputHash: string) {
    super('AI 返回的结构化脚本不符合当前契约，可安全重试或改用其他 Provider');
    this.name = 'ScriptContractError';
    this.diagnosticRef = `script_${outputHash.slice(0, 16)}`;
    this.issues = issues.slice(0, 20).map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    }));
  }

  toJSON(): { code: string; retryable: boolean; diagnosticRef: string; issues: ContractIssue[] } {
    return {
      code: this.code,
      retryable: this.retryable,
      diagnosticRef: this.diagnosticRef,
      issues: this.issues,
    };
  }
}

function nullableString(value: unknown, fallback: unknown = ''): unknown {
  return value == null ? fallback : value;
}

function arrayValue(value: unknown): unknown {
  if (value == null || value === '') return [];
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function normalizeStoryboard(item: unknown, index: number): unknown {
  if (!isJsonObject(item)) return item;
  return {
    ...item,
    scene_number: Number(item.scene_number ?? index + 1),
    description: nullableString(item.description ?? item.prompt),
    dialog: nullableString(item.dialog ?? item.subtitle_text),
    action: nullableString(item.action),
    duration: Number(item.duration ?? 5),
    prompt: nullableString(item.prompt ?? item.description),
    video_prompt: nullableString(item.video_prompt),
    negative_prompt: nullableString(item.negative_prompt),
    source_range: item.source_range || undefined,
    chapter_index: Number(item.chapter_index ?? item.chapter ?? 1),
    chapter_title: nullableString(item.chapter_title),
    subtitle_text: nullableString(item.subtitle_text ?? item.dialog),
    subtitle_style: item.subtitle_style ?? undefined,
    transition: nullableString(item.transition),
    voice: nullableString(item.voice),
    motion: nullableString(item.motion),
    no_voice: Boolean(item.no_voice),
    characters_in_scene: arrayValue(item.characters_in_scene),
    continuity_notes: nullableString(item.continuity_notes),
    scene_state_before: nullableString(item.scene_state_before),
    scene_state_after: nullableString(item.scene_state_after),
  };
}

function normalizeChapter(item: unknown, index: number): unknown {
  if (!isJsonObject(item)) return item;
  return {
    ...item,
    chapter_index: Number(item.chapter_index ?? index + 1),
    title: nullableString(item.title, `第 ${index + 1} 章`),
    summary: nullableString(item.summary),
    target_duration_sec: Number(item.target_duration_sec ?? 0),
  };
}

interface ScriptContext {
  theme?: unknown
  duration?: unknown
  style?: unknown
  detailLevel?: unknown
  language?: unknown
  provider?: unknown
  model?: unknown
}

export function validateStructuredScript(raw: unknown, context: ScriptContext = {}) {
  const outputHash = sha256(raw);
  const source: JsonObject = isJsonObject(raw) ? raw : {};
  const storyboards = Array.isArray(source.storyboards)
    ? source.storyboards.map(normalizeStoryboard)
    : source.storyboards;
  const totalDuration = Array.isArray(storyboards)
    ? storyboards.reduce((sum, item) => sum + (Number(isJsonObject(item) ? item.duration : 0) || 0), 0)
    : 0;
  const inputHash = sha256({
    theme: context.theme || '',
    duration: context.duration || '',
    style: context.style || '',
    detailLevel: context.detailLevel || 'standard',
    language: context.language || 'zh-CN',
  });
  const candidate = {
    ...source,
    schema_version: SCRIPT_SCHEMA_VERSION,
    prompt_version: SCRIPT_PROMPT_VERSION,
    input_hash: inputHash,
    language: context.language || source.language || 'zh-CN',
    style: context.style || source.style || '写实',
    title: nullableString(source.title, context.theme || '未命名脚本'),
    summary: nullableString(source.summary),
    total_duration: Number(source.total_duration ?? totalDuration),
    visual_anchor: nullableString(source.visual_anchor),
    story_bible: source.story_bible ?? {},
    characters: source.characters ?? [],
    chapters: Array.isArray(source.chapters) ? source.chapters.map(normalizeChapter) : (source.chapters ?? []),
    storyboards,
    long_video_mode: Boolean(source.long_video_mode),
    quality_warnings: source.quality_warnings ?? source._warnings ?? [],
  };

  const parsed = structuredScriptSchema.safeParse(candidate);
  if (!parsed.success) throw new ScriptContractError(parsed.error.issues, outputHash);
  return {
    ...parsed.data,
    generation: {
      provider: String(context.provider || 'unknown'),
      model: String(context.model || 'unknown'),
    },
  };
}
