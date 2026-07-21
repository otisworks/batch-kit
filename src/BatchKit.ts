import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { interpolate, toCustomId } from "./template.js";
import { StateManager } from "./stateManager.js";
import type {
  AddOptions,
  BatchKitOptions,
  BatchResult,
  JobRecord,
  RequestCounts,
  ReviewSummary,
  StagedRequest,
} from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_EXTENSIONS = [".txt", ".md"];

/** Options for {@link BatchKit.wait}. */
export interface WaitOptions {
  /** Poll interval in ms. Default 5000. */
  intervalMs?: number;
  /** Give up after this many ms. Default 24h. */
  timeoutMs?: number;
  /** Called on each poll with the current counts + status. */
  onPoll?: (info: { status: string; counts: RequestCounts }) => void;
}

/**
 * Main entry point. Stage documents, send them as a batch, poll, and read
 * results back.
 *
 * State persistence is intentionally not wired in yet — `add` stages
 * in-memory for now. That layer comes next.
 */
export class BatchKit {
  private readonly client: Anthropic;
  private readonly defaultModel: string;
  private readonly defaultMaxTokens: number;
  private readonly state: StateManager;

  constructor(options: BatchKitOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "No API key provided. Pass { apiKey } or set ANTHROPIC_API_KEY.",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
    this.state = new StateManager(options.stateDir);
  }

  /** Access the underlying state store (job history, latest lookup). */
  get store(): StateManager {
    return this.state;
  }

  /**
   * Resolve a batch id, supporting the special value `"latest"` which looks up
   * the most recently submitted job from persisted state.
   */
  async resolveBatchId(batchIdOrLatest: string): Promise<string> {
    if (batchIdOrLatest !== "latest") return batchIdOrLatest;
    const job = await this.state.latestJob();
    if (!job) {
      throw new Error("No previous batches found in state. Nothing to resolve for 'latest'.");
    }
    return job.batchId;
  }

  /**
   * Read supported files from a directory, interpolate the prompt template,
   * and stage them as requests. Returns the number of requests staged.
   */
  async add(dir: string, options: AddOptions): Promise<number> {
    const model = options.model ?? this.defaultModel;
    const maxTokens = options.maxTokens ?? this.defaultMaxTokens;
    const allowed = new Set(
      (options.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase()),
    );

    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(
        (e) => e.isFile() && allowed.has(path.extname(e.name).toLowerCase()),
      )
      .map((e) => e.name)
      .sort();

    if (files.length === 0) {
      throw new Error(
        `No files matching ${[...allowed].join(", ")} found in ${dir}`,
      );
    }

    // Staging is disk-backed so add/review/send work across CLI invocations.
    const staged = await this.state.loadStaged();
    const startIndex = staged.length;
    for (let i = 0; i < files.length; i++) {
      const filename = files[i]!;
      const raw = await readFile(path.join(dir, filename), "utf8");
      const index = startIndex + i;
      const prompt = interpolate(options.prompt, {
        content: raw.trim(),
        filename,
        index,
      });
      staged.push({
        customId: toCustomId(index, filename),
        filename,
        prompt,
        model,
        maxTokens,
      });
    }
    await this.state.saveStaged(staged);

    return files.length;
  }

  /** Preview what's currently staged. */
  async review(): Promise<ReviewSummary> {
    const staged = await this.state.loadStaged();
    return {
      count: staged.length,
      files: staged.map((r) => r.filename),
    };
  }

  /** The currently staged requests. */
  async stagedRequests(): Promise<StagedRequest[]> {
    return this.state.loadStaged();
  }

  /** Discard all staged requests. */
  async reset(): Promise<void> {
    await this.state.clearStaged();
  }

  /**
   * Submit all staged requests as a single batch. Returns the batch id.
   * Clears the staging area on success.
   */
  async send(): Promise<string> {
    const staged = await this.state.loadStaged();
    if (staged.length === 0) {
      throw new Error("Nothing staged. Call add() first.");
    }

    const requests = staged.map((r) => ({
      custom_id: r.customId,
      params: {
        model: r.model,
        max_tokens: r.maxTokens,
        messages: [{ role: "user" as const, content: r.prompt }],
      },
    }));

    const batch = await this.client.messages.batches.create({ requests });

    // Persist job metadata so future runs can find it (and map results -> files).
    const job: JobRecord = {
      batchId: batch.id,
      createdAt: new Date().toISOString(),
      model: staged[0]?.model ?? this.defaultModel,
      requestCount: staged.length,
      requests: staged.map((r) => ({
        customId: r.customId,
        filename: r.filename,
      })),
      lastStatus: batch.processing_status,
      lastCheckedAt: new Date().toISOString(),
    };
    await this.state.saveJob(job);
    await this.state.record({ op: "send", batchId: batch.id, detail: `${job.requestCount} requests` });

    await this.state.clearStaged();
    return batch.id;
  }

  /** Fetch the current status + counts for a batch. Accepts `"latest"`. */
  async status(
    batchIdOrLatest: string,
  ): Promise<{ status: string; counts: RequestCounts; endedAt: string | null; batchId: string }> {
    const batchId = await this.resolveBatchId(batchIdOrLatest);
    const batch = await this.client.messages.batches.retrieve(batchId);
    await this.state.updateStatus(batchId, batch.processing_status);
    await this.state.record({ op: "status", batchId, detail: batch.processing_status });
    return {
      status: batch.processing_status,
      counts: batch.request_counts,
      endedAt: batch.ended_at,
      batchId,
    };
  }

  /** Poll until the batch finishes processing (or timeout). Accepts `"latest"`. */
  async wait(batchIdOrLatest: string, options: WaitOptions = {}): Promise<void> {
    const batchId = await this.resolveBatchId(batchIdOrLatest);
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 24 * 60 * 60 * 1000;
    const start = Date.now();

    for (;;) {
      const batch = await this.client.messages.batches.retrieve(batchId);
      await this.state.updateStatus(batchId, batch.processing_status);
      options.onPoll?.({
        status: batch.processing_status,
        counts: batch.request_counts,
      });
      if (batch.processing_status === "ended") return;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for batch ${batchId} (still ${batch.processing_status})`,
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  /**
   * Stream normalized results for a completed batch. Results may arrive out of
   * order; use `customId` to match them back to source files.
   */
  async *results(batchIdOrLatest: string): AsyncGenerator<BatchResult> {
    const batchId = await this.resolveBatchId(batchIdOrLatest);
    await this.state.record({ op: "fetch", batchId });
    const stream = await this.client.messages.batches.results(batchId);
    for await (const item of stream) {
      const { custom_id: customId, result } = item;
      switch (result.type) {
        case "succeeded": {
          const text = result.message.content
            .filter((b): b is Extract<typeof b, { type: "text" }> =>
              b.type === "text",
            )
            .map((b) => b.text)
            .join("");
          yield { customId, type: "succeeded", message: result.message, text };
          break;
        }
        case "errored":
          yield { customId, type: "errored", error: result.error };
          break;
        case "canceled":
          yield { customId, type: "canceled" };
          break;
        case "expired":
          yield { customId, type: "expired" };
          break;
      }
    }
  }
}
