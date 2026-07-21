/**
 * Public types for batch-kit.
 *
 * We re-export a few SDK types so consumers don't need to import from
 * @anthropic-ai/sdk directly for the common cases.
 */
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";

/** Options for constructing a {@link BatchKit} instance. */
export interface BatchKitOptions {
  /** Anthropic API key. Defaults to `process.env.ANTHROPIC_API_KEY`. */
  apiKey?: string;
  /** Directory for persisted job state. Defaults to `./.batch-state`. */
  stateDir?: string;
  /** Default model for requests when not specified per-`add`. */
  defaultModel?: string;
  /** Default max_tokens for requests when not specified per-`add`. */
  defaultMaxTokens?: number;
}

/** Options passed to {@link BatchKit.add}. */
export interface AddOptions {
  /**
   * Prompt template. Supports `{content}`, `{filename}`, `{index}` variables.
   */
  prompt: string;
  /** Model override for this batch of documents. */
  model?: string;
  /** max_tokens override for this batch of documents. */
  maxTokens?: number;
  /** File extensions to include (lowercase, with dot). Defaults to `.txt`, `.md`. */
  extensions?: string[];
}

/** A single staged request, ready to be sent to the Batch API. */
export interface StagedRequest {
  /** Unique, API-safe id ([a-zA-Z0-9_-], <=64 chars). */
  customId: string;
  /** Source filename this request was built from. */
  filename: string;
  /** Fully-interpolated prompt text. */
  prompt: string;
  /** Model for this request. */
  model: string;
  /** max_tokens for this request. */
  maxTokens: number;
}

/** Result of {@link BatchKit.review}. */
export interface ReviewSummary {
  /** Number of staged requests. */
  count: number;
  /** Filenames staged. */
  files: string[];
}

/** Processing status mirrored from the Anthropic API. */
export type ProcessingStatus = "in_progress" | "canceling" | "ended";

/** Per-status tallies mirrored from the Anthropic API. */
export interface RequestCounts {
  processing: number;
  succeeded: number;
  errored: number;
  canceled: number;
  expired: number;
}

/** Maps a request's customId back to its source filename. */
export interface JobRequestRef {
  customId: string;
  filename: string;
}

/** Persisted metadata for a single submitted batch. */
export interface JobRecord {
  /** Anthropic batch id (e.g. msgbatch_...). */
  batchId: string;
  /** ISO timestamp when submitted via this tool. */
  createdAt: string;
  /** Model used for the batch. */
  model: string;
  /** Number of requests in the batch. */
  requestCount: number;
  /** customId -> filename mapping for matching results back to files. */
  requests: JobRequestRef[];
  /** Last known processing status (updated on status/wait/fetch). */
  lastStatus?: ProcessingStatus;
  /** ISO timestamp of the last status check. */
  lastCheckedAt?: string;
}

/** A single line in the append-only history log. */
export interface HistoryEntry {
  /** ISO timestamp of the operation. */
  at: string;
  /** Operation kind. */
  op: "send" | "status" | "fetch";
  /** Batch the operation concerns. */
  batchId: string;
  /** Optional free-form detail. */
  detail?: string;
}

/** One result line from a completed batch, normalized for consumers. */
export type BatchResult =
  | { customId: string; type: "succeeded"; message: Message; text: string }
  | { customId: string; type: "errored"; error: unknown }
  | { customId: string; type: "canceled" }
  | { customId: string; type: "expired" };
