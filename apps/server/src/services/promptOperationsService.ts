import { createHash, randomUUID } from 'node:crypto'
import {
  ArtifactDiffSchema,
  ArtifactHeadSchema,
  ArtifactVersionSchema,
  GoldenEvaluationSchema,
  PromptDiffSchema,
  PromptRevisionSchema,
  SkillPackageVersionSchema,
  type ArtifactVersion,
  type GoldenEvaluation,
  type JsonObject,
  type PromptDiff,
  type PromptRevision,
  type SkillPackageVersion,
} from '@aigc-director/contracts'
import type { DirectorDatabase } from '../db/database.js'

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function schemaProperties(schema: JsonObject): Set<string> {
  const properties = schema.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return new Set()
  return new Set(Object.keys(properties))
}

function promptVariables(revision: PromptRevision): Set<string> {
  const values = Object.values(revision.languageDrafts).join('\n')
  return new Set([...values.matchAll(/\{\{\s*([a-z][a-zA-Z0-9_]*)\s*\}\}/gu)].map((match) => match[1]!))
}

function semanticVersionAfter(version: string): string {
  const [major, minor, patch] = version.split('.').map((part) => Number.parseInt(part, 10))
  return `${major ?? 0}.${minor ?? 0}.${(patch ?? 0) + 1}`
}

function latestSkillVersion(versions: SkillPackageVersion[]): SkillPackageVersion | undefined {
  return versions.reduce<SkillPackageVersion | undefined>((latest, candidate) => {
    if (!latest) return candidate
    const left = latest.version.split('.').map((part) => Number.parseInt(part, 10))
    const right = candidate.version.split('.').map((part) => Number.parseInt(part, 10))
    for (let index = 0; index < 3; index += 1) {
      const difference = (right[index] ?? 0) - (left[index] ?? 0)
      if (difference > 0) return candidate
      if (difference < 0) return latest
    }
    return candidate.createdAt > latest.createdAt ? candidate : latest
  }, undefined)
}

export class PromptOperationsService {
  constructor(private readonly database: DirectorDatabase) {}

  createPromptRevision(input: {
    projectId?: string | undefined; stableKey: string; title: string; role: PromptRevision['role'];
    languageDrafts: PromptRevision['languageDrafts']; feedback?: string | undefined; variablesSchema: JsonObject;
    outputSchema: JsonObject; modelPolicy?: JsonObject | undefined; status?: PromptRevision['status'] | undefined; source?: PromptRevision['source'] | undefined;
  }): PromptRevision {
    if (input.projectId && !this.database.getProject(input.projectId)) throw new Error('PROJECT_NOT_FOUND')
    const current = this.database.listPromptRevisions(input.stableKey, input.projectId)[0]
    const timestamp = new Date().toISOString()
    const content = {
      stableKey: input.stableKey, title: input.title, role: input.role, languageDrafts: input.languageDrafts,
      feedback: input.feedback ?? '', variablesSchema: input.variablesSchema, outputSchema: input.outputSchema,
      modelPolicy: input.modelPolicy ?? {}, status: input.status ?? 'draft', source: input.source ?? 'original-clean-room',
    }
    return this.database.createPromptRevision(PromptRevisionSchema.parse({
      id: randomUUID(), ...(input.projectId ? { projectId: input.projectId } : {}), ...content,
      revision: (current?.revision ?? 0) + 1, ...(current ? { parentRevisionId: current.id } : {}),
      contentHash: hash(content), createdAt: timestamp, updatedAt: timestamp,
    }))
  }

  validatePrompt(revisionId: string): { valid: boolean; missingVariables: string[]; evaluations: GoldenEvaluation[] } {
    const revision = this.database.getPromptRevision(revisionId)
    if (!revision) throw new Error('PROMPT_REVISION_NOT_FOUND')
    const declared = schemaProperties(revision.variablesSchema)
    const missingVariables = [...promptVariables(revision)].filter((name) => !declared.has(name)).sort()
    const evaluations = this.database.listGoldenEvaluations('prompt', revision.id)
    return { valid: missingVariables.length === 0 && evaluations.some((evaluation) => evaluation.status === 'passed'), missingVariables, evaluations }
  }

  compilePrompt(revisionId: string, variables: JsonObject): { zhReview: string; enExecution: string; compiledHash: string } {
    const revision = this.database.getPromptRevision(revisionId)
    if (!revision) throw new Error('PROMPT_REVISION_NOT_FOUND')
    const required = promptVariables(revision)
    const missing = [...required].filter((name) => typeof variables[name] !== 'string' && typeof variables[name] !== 'number' && typeof variables[name] !== 'boolean')
    if (missing.length > 0) throw new Error(`PROMPT_VARIABLE_MISSING:${missing.join(',')}`)
    const render = (value: string): string => value.replace(/\{\{\s*([a-z][a-zA-Z0-9_]*)\s*\}\}/gu, (_match, name: string) => String(variables[name]))
    const zhReview = render(revision.languageDrafts.zhReview)
    const enExecution = render(revision.languageDrafts.enExecution)
    return { zhReview, enExecution, compiledHash: hash({ revisionId, contentHash: revision.contentHash, variables, zhReview, enExecution }) }
  }

  diffPrompt(fromId: string, toId: string): PromptDiff {
    const from = this.database.getPromptRevision(fromId)
    const to = this.database.getPromptRevision(toId)
    if (!from || !to || from.stableKey !== to.stableKey) throw new Error('PROMPT_REVISION_NOT_FOUND')
    const fields: Array<[PromptDiff['changes'][number]['field'], unknown, unknown]> = [
      ['title', from.title, to.title], ['original', from.languageDrafts.original, to.languageDrafts.original],
      ['zhReview', from.languageDrafts.zhReview, to.languageDrafts.zhReview], ['enExecution', from.languageDrafts.enExecution, to.languageDrafts.enExecution],
      ['feedback', from.feedback, to.feedback], ['variablesSchema', from.variablesSchema, to.variablesSchema],
      ['outputSchema', from.outputSchema, to.outputSchema], ['modelPolicy', from.modelPolicy, to.modelPolicy], ['status', from.status, to.status],
    ]
    return PromptDiffSchema.parse({
      fromRevisionId: from.id, toRevisionId: to.id,
      changes: fields.filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right)).map(([field, left, right]) => ({
        field, kind: left === undefined ? 'added' : right === undefined ? 'removed' : 'changed',
        before: typeof left === 'string' ? left : JSON.stringify(left), after: typeof right === 'string' ? right : JSON.stringify(right),
      })),
    })
  }

  restorePrompt(revisionId: string): PromptRevision {
    const target = this.database.getPromptRevision(revisionId)
    if (!target) throw new Error('PROMPT_REVISION_NOT_FOUND')
    return this.createPromptRevision({
      ...(target.projectId ? { projectId: target.projectId } : {}), stableKey: target.stableKey, title: target.title, role: target.role,
      languageDrafts: target.languageDrafts, feedback: `从 revision ${target.revision} 恢复`, variablesSchema: target.variablesSchema,
      outputSchema: target.outputSchema, modelPolicy: target.modelPolicy, status: 'draft', source: target.source === 'builtin' ? 'original-clean-room' : target.source,
    })
  }

  evaluateGolden(input: Omit<GoldenEvaluation, 'id' | 'status' | 'createdAt'>): GoldenEvaluation {
    const required = Array.isArray(input.expectedSchema.required) ? input.expectedSchema.required.filter((key): key is string => typeof key === 'string') : []
    const status = required.every((key) => Object.hasOwn(input.fakeOutput, key)) ? 'passed' : 'failed'
    return this.database.putGoldenEvaluation(GoldenEvaluationSchema.parse({
      ...input, id: randomUUID(), status, ...(status === 'failed' ? { diagnosticCode: 'GOLDEN_SCHEMA_REQUIRED_MISSING' } : {}), createdAt: new Date().toISOString(),
    }))
  }

  publishPrompt(revisionId: string): PromptRevision {
    const target = this.database.getPromptRevision(revisionId)
    if (!target) throw new Error('PROMPT_REVISION_NOT_FOUND')
    const validation = this.validatePrompt(revisionId)
    if (!validation.valid) throw new Error('PROMPT_PUBLISH_GATE_FAILED')
    return this.createPromptRevision({
      ...(target.projectId ? { projectId: target.projectId } : {}), stableKey: target.stableKey, title: target.title, role: target.role,
      languageDrafts: target.languageDrafts, feedback: target.feedback, variablesSchema: target.variablesSchema,
      outputSchema: target.outputSchema, modelPolicy: target.modelPolicy, status: 'published', source: target.source,
    })
  }

  rollbackArtifact(projectId: string, targetVersionId: string, expectedHeadRevision: number, expectedScope?: ArtifactVersion['scope']): ArtifactVersion {
    const target = this.database.get<ArtifactVersion>('artifact_versions', targetVersionId)
    if (!target || target.projectId !== projectId) throw new Error('ARTIFACT_VERSION_NOT_FOUND')
    if (expectedScope && (target.scope.type !== expectedScope.type || target.scope.id !== expectedScope.id)) throw new Error('ARTIFACT_SCOPE_MISMATCH')
    const versions = this.database.list<ArtifactVersion>('artifact_versions', projectId)
      .filter((version) => version.artifactType === target.artifactType && version.scope.type === target.scope.type && version.scope.id === target.scope.id)
      .sort((left, right) => right.revision - left.revision)
    const current = versions[0]
    const currentHead = this.database.getArtifactHead(target.scope, target.artifactType)
    const actualHeadRevision = currentHead?.expectedRevision ?? current?.revision ?? 0
    if (actualHeadRevision !== expectedHeadRevision) throw new Error('ARTIFACT_HEAD_CONFLICT')
    const timestamp = new Date().toISOString()
    const rollback = ArtifactVersionSchema.parse({
      ...target, id: randomUUID(), revision: (current?.revision ?? 0) + 1,
      ...(current ? { parentArtifactVersionId: current.id } : {}), status: 'approved', createdAt: timestamp, updatedAt: timestamp,
    })
    const head = ArtifactHeadSchema.parse({
      scope: target.scope, artifactType: target.artifactType, currentVersionId: rollback.id,
      expectedRevision: rollback.revision, updatedAt: timestamp,
    })
    return this.database.transaction(() => {
      this.database.put('artifact_versions', projectId, rollback)
      this.database.putArtifactHead(head, currentHead?.expectedRevision ?? 0)
      return rollback
    })
  }

  listArtifactVersions(projectId: string, scope: ArtifactVersion['scope'], artifactType: string): ArtifactVersion[] {
    if (!this.database.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
    return this.database.list<ArtifactVersion>('artifact_versions', projectId)
      .filter((version) => version.artifactType === artifactType && version.scope.type === scope.type && version.scope.id === scope.id)
      .sort((left, right) => right.revision - left.revision)
  }

  diffArtifact(projectId: string, fromId: string, toId: string, expectedScope?: ArtifactVersion['scope']): { fromVersionId: string; toVersionId: string; changes: Array<{ field: string; before?: unknown; after?: unknown }> } {
    const from = this.database.get<ArtifactVersion>('artifact_versions', fromId)
    const to = this.database.get<ArtifactVersion>('artifact_versions', toId)
    if (!from || !to || from.projectId !== projectId || to.projectId !== projectId || from.artifactType !== to.artifactType) throw new Error('ARTIFACT_VERSION_NOT_FOUND')
    if (expectedScope && [from, to].some((artifact) => artifact.scope.type !== expectedScope.type || artifact.scope.id !== expectedScope.id)) throw new Error('ARTIFACT_SCOPE_MISMATCH')
    const keys = new Set([...Object.keys(from.content), ...Object.keys(to.content)])
    const changes = [...keys].filter((key) => JSON.stringify(from.content[key]) !== JSON.stringify(to.content[key]))
      .map((field) => ({ field, ...(from.content[field] === undefined ? {} : { before: from.content[field] }), ...(to.content[field] === undefined ? {} : { after: to.content[field] }) }))
    return ArtifactDiffSchema.parse({ fromVersionId: from.id, toVersionId: to.id, changes })
  }

  createSkillVersion(input: {
    projectId?: string | undefined; stableKey: string; name: string; description?: string | undefined; markdown: string;
    resources?: SkillPackageVersion['resources'] | undefined;
  }): SkillPackageVersion {
    if (input.projectId && !this.database.getProject(input.projectId)) throw new Error('PROJECT_NOT_FOUND')
    const current = latestSkillVersion(this.database.listSkillPackageVersions(input.stableKey, input.projectId))
    const version = current ? semanticVersionAfter(current.version) : '1.0.0'
    const resources = input.resources ?? []
    const timestamp = new Date().toISOString()
    const contentHash = hash({ markdown: input.markdown, resources })
    return this.database.createSkillPackageVersion(SkillPackageVersionSchema.parse({
      id: randomUUID(), ...(input.projectId ? { projectId: input.projectId } : {}), stableKey: input.stableKey, version,
      ...(current ? { parentVersionId: current.id } : {}),
      manifest: {
        id: randomUUID(), name: input.name, version, description: input.description ?? '', entry: 'SKILL.md',
        resources: resources.map((resource) => resource.path), sha256: contentHash,
      },
      markdown: input.markdown, resources, trustLevel: input.projectId ? 'project' : 'reviewed',
      status: 'draft', source: 'original-clean-room', contentHash, createdAt: timestamp, updatedAt: timestamp,
    }))
  }

  forkSkill(sourceVersionId: string, projectId?: string): SkillPackageVersion {
    const source = this.database.getSkillPackageVersion(sourceVersionId)
    if (!source) throw new Error('SKILL_VERSION_NOT_FOUND')
    if (projectId && !this.database.getProject(projectId)) throw new Error('PROJECT_NOT_FOUND')
    const timestamp = new Date().toISOString()
    const latest = latestSkillVersion(this.database.listSkillPackageVersions(source.stableKey, projectId))
    const nextVersion = semanticVersionAfter(latest?.version ?? source.version)
    return this.database.createSkillPackageVersion(SkillPackageVersionSchema.parse({
      ...source, id: randomUUID(), ...(projectId ? { projectId } : { projectId: undefined }), version: nextVersion,
      manifest: { ...source.manifest, id: randomUUID(), version: nextVersion },
      parentVersionId: source.id, trustLevel: projectId ? 'project' : 'reviewed', status: 'draft', source: 'user-fork',
      contentHash: hash({ markdown: source.markdown, resources: source.resources, parentVersionId: source.id }), createdAt: timestamp, updatedAt: timestamp,
    }))
  }

  validateSkill(versionId: string): { valid: boolean; issues: string[]; evaluations: GoldenEvaluation[] } {
    const version = this.database.getSkillPackageVersion(versionId)
    if (!version) throw new Error('SKILL_VERSION_NOT_FOUND')
    const allowed = /\.(?:md|json|txt|png|jpe?g|webp)$/iu
    const issues = version.resources.filter((resource) => !allowed.test(resource.path)).map((resource) => `SKILL_RESOURCE_TYPE_REJECTED:${resource.path}`)
    const evaluations = this.database.listGoldenEvaluations('skill', version.id)
    return { valid: issues.length === 0 && evaluations.some((evaluation) => evaluation.status === 'passed'), issues, evaluations }
  }

  publishSkill(versionId: string): SkillPackageVersion {
    const target = this.database.getSkillPackageVersion(versionId)
    if (!target) throw new Error('SKILL_VERSION_NOT_FOUND')
    if (!this.validateSkill(versionId).valid) throw new Error('SKILL_PUBLISH_GATE_FAILED')
    return this.cloneSkillVersion(target, 'published')
  }

  rollbackSkill(versionId: string): SkillPackageVersion {
    const target = this.database.getSkillPackageVersion(versionId)
    if (!target) throw new Error('SKILL_VERSION_NOT_FOUND')
    return this.cloneSkillVersion(target, 'draft')
  }

  private cloneSkillVersion(target: SkillPackageVersion, status: SkillPackageVersion['status']): SkillPackageVersion {
    const latest = latestSkillVersion(this.database.listSkillPackageVersions(target.stableKey, target.projectId))
    const version = semanticVersionAfter(latest?.version ?? target.version)
    const timestamp = new Date().toISOString()
    return this.database.createSkillPackageVersion(SkillPackageVersionSchema.parse({
      ...target, id: randomUUID(), version, manifest: { ...target.manifest, id: randomUUID(), version },
      parentVersionId: target.id, status, source: target.source === 'builtin' ? 'user-fork' : target.source,
      contentHash: hash({ markdown: target.markdown, resources: target.resources, parentVersionId: target.id, status }),
      createdAt: timestamp, updatedAt: timestamp,
    }))
  }
}
