import { randomUUID } from "node:crypto";
import { validationError } from "./errors.js";
import type { CompiledPrompt, PromptRun } from "./types.js";

export interface AliasHistoryEntry {
  alias: string;
  from?: string;
  to: string;
  reason: string;
  changedAt: string;
  changedBy: string;
}

export class PromptVersionStore {
  private readonly aliases = new Map<string, string>();
  private readonly history: AliasHistoryEntry[] = [];
  private readonly runs = new Map<string, PromptRun>();

  publish(alias: string, exactVersion: string, reason: string, changedBy: string): AliasHistoryEntry {
    if (!exactVersion.includes("@")) {
      throw validationError("ALIAS_REQUIRES_EXACT_VERSION", "Alias targets must use id@version");
    }
    const previous = this.aliases.get(alias);
    this.aliases.set(alias, exactVersion);
    const entry: AliasHistoryEntry = {
      alias,
      ...(previous ? { from: previous } : {}),
      to: exactVersion,
      reason,
      changedAt: new Date().toISOString(),
      changedBy
    };
    this.history.push(entry);
    return entry;
  }

  rollback(alias: string, historyIndex: number, reason: string, changedBy: string): AliasHistoryEntry {
    const candidates = this.history.filter((entry) => entry.alias === alias);
    const target = candidates[historyIndex];
    if (!target) throw validationError("ROLLBACK_TARGET_NOT_FOUND", `No alias history at index ${historyIndex}`);
    return this.publish(alias, target.to, reason, changedBy);
  }

  resolveAlias(alias: string): string {
    const found = this.aliases.get(alias);
    if (!found) throw validationError("PROMPT_ALIAS_NOT_FOUND", `Alias not found: ${alias}`);
    return found;
  }

  createRun(compiled: CompiledPrompt, parentPromptRunId?: string): PromptRun {
    if (parentPromptRunId && !this.runs.has(parentPromptRunId)) {
      throw validationError("PARENT_PROMPT_RUN_NOT_FOUND", `Prompt run not found: ${parentPromptRunId}`);
    }
    const run: PromptRun = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      compiled,
      ...(parentPromptRunId ? { parentPromptRunId } : {}),
      status: "compiled"
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(id: string): PromptRun {
    const found = this.runs.get(id);
    if (!found) throw validationError("PROMPT_RUN_NOT_FOUND", `Prompt run not found: ${id}`);
    return found;
  }

  listHistory(alias: string): AliasHistoryEntry[] {
    return this.history.filter((entry) => entry.alias === alias);
  }
}
