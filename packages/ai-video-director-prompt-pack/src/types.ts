export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export type EvidenceLevel = "verified" | "partially-verified" | "unverified";
export type ProvenanceMode = "original" | "adapted" | "behavioral-reference";

export interface ProvenanceRecord {
  mode: ProvenanceMode;
  project: string;
  commit?: string;
  source?: string;
  license: string;
  evidence: EvidenceLevel;
  copied: false;
  note: string;
}

export interface PromptDefinition {
  id: string;
  version: string;
  status: "draft" | "canary" | "active" | "retired";
  title: string;
  stage: string;
  description: string;
  localeMode: "zh-to-bilingual";
  variablesSchema: JsonSchema;
  outputSchema: JsonSchema;
  template: string;
  hardRules: string[];
  modelCapabilities: string[];
  evalSuite: string[];
  provenance: ProvenanceRecord[];
  contentHash?: string;
}

export type SkillTrustLevel = "builtin" | "reviewed" | "project" | "untrusted";

export interface SkillManifest {
  id: string;
  version: string;
  title: string;
  family: "story.genre" | "art.style" | "production";
  purpose: string;
  stages: string[];
  triggers: string[];
  trustLevel: SkillTrustLevel;
  compatiblePromptIds: string[];
  policyPatch: {
    instructions: string[];
    rubric: string[];
    preferredModules: string[];
  };
  forbiddenOverrides: string[];
  provenance: ProvenanceRecord[];
  contentHash?: string;
}

export interface WorkflowGate {
  after: string;
  kind: "automatic" | "human-review" | "policy-review";
  conditions: string[];
}

export interface WorkflowDefinition {
  id: string;
  version: string;
  title: string;
  steps: Array<{
    id: string;
    promptId?: string;
    action?: string;
    dependsOn: string[];
    produces: string;
  }>;
  gates: WorkflowGate[];
  pauseConditions: string[];
}

export interface ModelCapability {
  modelId: string;
  providerId: string;
  modalities: string[];
  features: string[];
  limits: Record<string, number | string | boolean | string[]>;
  enabled: boolean;
  snapshotVersion: string;
}

export interface ProviderProfile {
  id: string;
  version: string;
  title: string;
  family: string;
  transport: "native" | "openai-compatible" | "declarative-http" | "owner-script";
  baseUrl?: string;
  auth: {
    scheme: "bearer" | "api-key" | "custom";
    header: string;
    secretRefRequired: boolean;
  };
  modalities: string[];
  features: string[];
  async: boolean;
  supportsCancel: boolean;
  supportsReconcile: boolean;
  prompt: {
    languages: string[];
    negativePrompt: "field" | "inline" | "unsupported";
    referenceSyntax: "api-field" | "ordinal-tag" | "named-tag";
  };
  notes: string[];
}

export interface PromptPolicy {
  safetyRules: string[];
  identityLocks: string[];
  continuityLocks: string[];
  approvedFacts: string[];
  userRequirements: string[];
  maxCompiledChars?: number;
}

export interface PromptRef {
  id: string;
  version: string;
}

export interface SkillRef {
  id: string;
  version: string;
}

export interface CompilePromptInput {
  prompt: PromptRef;
  variables: JsonObject;
  skills?: SkillRef[];
  providerProfileId?: string;
  policy: PromptPolicy;
}

export interface PromptProvenance {
  prompt: PromptRef & { contentHash: string };
  skills: Array<SkillRef & { contentHash: string }>;
  providerProfile?: { id: string; version: string; contentHash: string };
  variablesHash: string;
  compiledHash: string;
  precedence: string[];
}

export interface CompiledPrompt {
  system: string;
  canonical: string;
  zhReview: string;
  enExecution: string;
  outputSchema: JsonSchema;
  warnings: string[];
  provenance: PromptProvenance;
}

export interface PromptRun {
  id: string;
  createdAt: string;
  compiled: CompiledPrompt;
  parentPromptRunId?: string;
  status: "compiled" | "submitted" | "succeeded" | "failed" | "rolled-back";
}

export interface GenerationRequirements {
  modalities: string[];
  features: string[];
  maxCost?: number;
  preferredProviders?: string[];
}

export interface ModelSelectionPolicy {
  allowCapabilityDowngrade: boolean;
  allowedProviders?: string[];
}

export interface ModelSelection {
  model: ModelCapability;
  profile: ProviderProfile;
  reasons: string[];
  downgradedFeatures: string[];
}

export interface MediaRef {
  id: string;
  kind: "artifact" | "local" | "object" | "remote";
  uri: string;
  sha256?: string;
  mimeType: string;
  role?: string;
  ordinal?: number;
}

export interface ProviderRequest {
  taskId: string;
  modelId: string;
  promptRunId: string;
  prompt: string;
  negativePrompt?: string;
  media: MediaRef[];
  parameters: JsonObject;
}

export interface IdempotencyContext {
  key: string;
  attempt: number;
}

export interface ProviderReceipt {
  providerId: string;
  remoteJobId: string;
  acceptedAt: string;
  rawStatus?: string;
}

export type ProviderState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "outcome_unknown";

export interface ProviderObservation {
  state: ProviderState;
  progress?: number;
  outputs?: MediaRef[];
  data?: JsonValue;
  error?: DomainErrorShape;
  rawStatus?: string;
}

export interface CancelObservation {
  state: "cancelled" | "unsupported" | "already-terminal" | "outcome_unknown";
  detail?: string;
}

export interface ReconcileQuery {
  receipt?: ProviderReceipt;
  idempotencyKey: string;
}

export interface ReconcileObservation extends ProviderObservation {
  matchedBy: "remote-job-id" | "idempotency-key" | "not-found";
}

export interface ProviderAdapter {
  readonly profile: ProviderProfile;
  submit(request: ProviderRequest, context: IdempotencyContext): Promise<ProviderReceipt>;
  poll(receipt: ProviderReceipt): Promise<ProviderObservation>;
  cancel(receipt: ProviderReceipt): Promise<CancelObservation>;
  reconcile(query: ReconcileQuery): Promise<ReconcileObservation>;
}

export interface DiagnosticEnvelope {
  correlationId: string;
  code: string;
  publicMessage: string;
  privateDetailRef?: string;
  retryAdvice: "never" | "after-fix" | "backoff" | "reconcile-first" | "human-review";
  outcomeCertainty: "certain" | "unknown";
}

export interface DomainErrorShape {
  code: string;
  category:
    | "validation"
    | "policy"
    | "capability"
    | "security"
    | "provider_auth"
    | "provider_transient"
    | "provider_rejected"
    | "transport"
    | "media"
    | "persistence"
    | "human";
  message: string;
  retryable: boolean;
  outcomeCertainty: "certain" | "unknown";
  details?: JsonObject;
}

export interface PromptPackData {
  prompts: PromptDefinition[];
  skills: SkillManifest[];
  workflows: WorkflowDefinition[];
  providerProfiles: ProviderProfile[];
  evals: EvalCase[];
}

export interface EvalCase {
  id: string;
  title: string;
  promptId: string;
  fixture: JsonObject;
  hardAssertions: string[];
  rubric: string[];
  rights: "original-synthetic";
}

export interface EvalJudgment {
  assertion: string;
  passed: boolean;
  evidence: string;
}

export interface EvalRunResult {
  caseId: string;
  schemaPassed: boolean;
  hardAssertionsPassed: boolean;
  judgments: EvalJudgment[];
  rubricScores: Record<string, number>;
  releaseBlocked: boolean;
}

export interface OwnerScriptManifest {
  id: string;
  version: string;
  entry: string;
  sha256: string;
  allowedHosts: string[];
  capabilities: string[];
  secretRefs: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  trustedOwnerOnly: true;
}

export interface RestrictedHttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: JsonValue;
  authRef?: string;
}

export interface RestrictedHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: JsonValue;
}
