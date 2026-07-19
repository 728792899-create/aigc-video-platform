import { validationError } from "../errors.js";
import type { ProviderProfile } from "../types.js";
import type { DeclarativeAdapterConfig } from "./declarative.js";
import { DeclarativeHttpAdapter } from "./declarative.js";
import type { HttpExecutor } from "./http.js";

export const NATIVE_PROVIDER_FAMILY_IDS = [
  "openai",
  "google-gemini",
  "anthropic",
  "runway",
  "volcengine-ark",
  "alibaba-model-studio",
  "kling",
  "minimax",
  "tencent-hunyuan",
  "fal-ai"
] as const;

export type NativeProviderFamilyId = (typeof NATIVE_PROVIDER_FAMILY_IDS)[number];

export interface NativeProviderFamily {
  id: NativeProviderFamilyId;
  title: string;
  protocolNotes: string[];
  defaultStatusMap: Record<string, "queued" | "running" | "succeeded" | "failed" | "cancelled">;
}

const COMMON_STATUS = {
  queued: "queued",
  pending: "queued",
  submitted: "queued",
  starting: "queued",
  running: "running",
  processing: "running",
  in_progress: "running",
  succeeded: "succeeded",
  successful: "succeeded",
  completed: "succeeded",
  success: "succeeded",
  failed: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled"
} as const;

export const NATIVE_PROVIDER_FAMILIES: NativeProviderFamily[] = [
  { id: "openai", title: "OpenAI", protocolNotes: ["Responses/image/video endpoints are capability-specific."], defaultStatusMap: { ...COMMON_STATUS } },
  { id: "google-gemini", title: "Google Gemini / Veo", protocolNotes: ["Long-running operations require polling by operation name."], defaultStatusMap: { ...COMMON_STATUS, done: "succeeded" } },
  { id: "anthropic", title: "Anthropic", protocolNotes: ["Bundled profile is text-first; media generation is unsupported."], defaultStatusMap: { ...COMMON_STATUS } },
  { id: "runway", title: "Runway", protocolNotes: ["Generations are normalized as asynchronous tasks."], defaultStatusMap: { ...COMMON_STATUS } },
  { id: "volcengine-ark", title: "Volcengine Ark", protocolNotes: ["Model and region endpoints remain configuration data."], defaultStatusMap: { ...COMMON_STATUS } },
  { id: "alibaba-model-studio", title: "Alibaba Model Studio / Wan", protocolNotes: ["Region, workspace endpoint and async task IDs are explicit."], defaultStatusMap: { ...COMMON_STATUS, SUCCEEDED: "succeeded", FAILED: "failed", RUNNING: "running", PENDING: "queued" } },
  { id: "kling", title: "Kling Open Platform", protocolNotes: ["Capabilities are loaded from a versioned project profile."], defaultStatusMap: { ...COMMON_STATUS } },
  { id: "minimax", title: "MiniMax", protocolNotes: ["Video creation, query and file retrieval are separate stages."], defaultStatusMap: { ...COMMON_STATUS, Preparing: "queued", Queueing: "queued", Processing: "running", Success: "succeeded", Fail: "failed" } },
  { id: "tencent-hunyuan", title: "Tencent Hunyuan", protocolNotes: ["Only explicitly configured media capabilities are exposed."], defaultStatusMap: { ...COMMON_STATUS } },
  { id: "fal-ai", title: "fal.ai", protocolNotes: ["Queue submit/status/result/cancel use one normalized task contract."], defaultStatusMap: { ...COMMON_STATUS, IN_QUEUE: "queued", IN_PROGRESS: "running", COMPLETED: "succeeded" } }
];

export function createNativeProviderAdapter(
  profile: ProviderProfile,
  config: Omit<DeclarativeAdapterConfig, "profile" | "statusMap"> & { statusMap?: DeclarativeAdapterConfig["statusMap"] },
  executor: HttpExecutor
): DeclarativeHttpAdapter {
  const family = NATIVE_PROVIDER_FAMILIES.find((item) => item.id === profile.family);
  if (!family) throw validationError("NATIVE_PROVIDER_FAMILY_UNKNOWN", `Unknown family: ${profile.family}`);
  return new DeclarativeHttpAdapter(
    {
      ...config,
      profile,
      statusMap: config.statusMap ?? family.defaultStatusMap
    },
    executor
  );
}
