import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FakeProviderAdapter,
  ModelCatalog,
  asJsonValue,
  contentHash,
  compilePrompt as compilePackPrompt,
  loadPromptPack,
  parsePromptOutput,
  type CompilePromptInput,
  type CompiledPrompt,
  type FakeScenario,
  type GenerationRequirements,
  type ModelCapability,
  type ModelSelection,
  type JsonObject,
  type PromptRegistry,
  type ProviderProfile,
} from '@local/ai-video-director-prompt-pack'

export const PROMPT_PACK_COUNTS = Object.freeze({ prompts: 26, skills: 31, workflows: 2 })
export const PROMPT_PACK_PACKAGE = '@local/ai-video-director-prompt-pack@0.1.0'

export const DEMO_PROVIDER_PROFILE: ProviderProfile = {
  id: 'demo-local',
  version: '2.0.0',
  title: '确定性本地 Fake Provider',
  family: 'demo-local',
  transport: 'native',
  auth: { scheme: 'custom', header: 'none', secretRefRequired: false },
  modalities: ['text', 'image', 'audio', 'video'],
  features: ['text', 'structured-output', 'image-generation', 'reference-images', 'audio', 'video-generation', 'first-frame', 'cancel', 'reconcile'],
  async: true,
  supportsCancel: true,
  supportsReconcile: true,
  prompt: { languages: ['zh-CN', 'en'], negativePrompt: 'field', referenceSyntax: 'named-tag' },
  notes: ['只生成确定性本地 fixture。', '不得进行网络或付费 Provider 请求。'],
}

export const DEMO_IMAGE_MODEL: ModelCapability = {
  modelId: 'demo-frame-v1',
  providerId: 'demo-local',
  modalities: ['image'],
  features: ['image-generation', 'reference-images', 'first-frame', 'reconcile', 'cancel'],
  limits: { maxInputs: 100, networkRequests: 0, billed: false },
  enabled: true,
  snapshotVersion: 'demo-frame-v1@2.0.0',
}

export const DEMO_STRUCTURED_MODEL: ModelCapability = {
  modelId: 'demo-structured-v1',
  providerId: 'demo-local',
  modalities: ['text'],
  features: ['text', 'structured-output', 'reconcile', 'cancel'],
  limits: { maxInputs: 100, maxOutputChars: 50_000, networkRequests: 0, billed: false },
  enabled: true,
  snapshotVersion: 'demo-structured-v1@2.0.0',
}

let cachedRegistry: Promise<PromptRegistry> | undefined

async function directoryExists(path: string): Promise<boolean> {
  try {
    await access(resolve(path, 'registry', 'prompts.json'))
    return true
  } catch {
    return false
  }
}

export async function resolvePromptPackRoot(explicitRoot?: string): Promise<string> {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    explicitRoot,
    process.env.AIGC_PROMPT_PACK_ROOT,
    resolve(moduleDirectory, 'prompt-pack'),
    resolve(moduleDirectory, '../../ai-video-director-prompt-pack'),
    resolve(process.cwd(), 'packages/ai-video-director-prompt-pack'),
    resolve(process.cwd(), '../ai-video-director-prompt-pack'),
    resolve(process.cwd(), '../../packages/ai-video-director-prompt-pack'),
  ].filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) return candidate
  }
  throw new Error(`PROMPT_PACK_ROOT_NOT_FOUND:${candidates.join(',')}`)
}

export function resetPromptPackCacheForTests(): void {
  cachedRegistry = undefined
}

export async function loadDirectorPromptPack(explicitRoot?: string): Promise<PromptRegistry> {
  if (explicitRoot) return loadPromptPack(await resolvePromptPackRoot(explicitRoot))
  cachedRegistry ??= resolvePromptPackRoot().then((root) => loadPromptPack(root))
  return cachedRegistry
}

export async function compileDirectorPrompt(input: CompilePromptInput): Promise<CompiledPrompt> {
  return compilePackPrompt(await loadDirectorPromptPack(), input)
}

export function asDirectorJsonObject(value: unknown): JsonObject {
  const json = asJsonValue(value)
  if (!json || Array.isArray(json) || typeof json !== 'object') throw new Error('DIRECTOR_JSON_OBJECT_REQUIRED')
  return json
}

export async function parseDirectorPromptOutput(
  prompt: { id: string; version: string },
  output: unknown,
  options: { echoNeedle?: string; invariantFailures?: string[] } = {},
): Promise<JsonObject> {
  return parsePromptOutput(await loadDirectorPromptPack(), prompt, JSON.stringify(output), options)
}

export function createDemoPackProvider(overrides: Partial<Pick<FakeScenario, 'submit' | 'cancel' | 'reconcile'>> = {}): FakeProviderAdapter {
  const scenario: FakeScenario = {
    id: 'aigc-director-demo-success',
    submit: overrides.submit ?? 'accept',
    observations: [
      { afterPoll: 1, state: 'running', progress: 0.5 },
      { afterPoll: 2, state: 'succeeded', progress: 1 },
    ],
    cancel: overrides.cancel ?? 'cancelled',
    reconcile: overrides.reconcile ?? 'succeeded',
  }
  return new FakeProviderAdapter(DEMO_PROVIDER_PROFILE, scenario)
}

export function demoProviderProfileRef(): { id: string; version: string; contentHash: string } {
  return { id: DEMO_PROVIDER_PROFILE.id, version: DEMO_PROVIDER_PROFILE.version, contentHash: contentHash(DEMO_PROVIDER_PROFILE) }
}

export function resolveDemoModelSelection(requirements: GenerationRequirements): ModelSelection {
  return new ModelCatalog([DEMO_IMAGE_MODEL, DEMO_STRUCTURED_MODEL], [DEMO_PROVIDER_PROFILE]).resolve(requirements, {
    allowCapabilityDowngrade: false,
    allowedProviders: ['demo-local'],
  })
}
