import { mkdir, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { HistoryEntry, JobRecord, StagedRequest } from "./types.js";

/**
 * Persists batch job metadata to disk under a state directory.
 *
 * Layout:
 *   <stateDir>/
 *     jobs/<batchId>.json    one file per submitted batch
 *     history.jsonl          append-only operation log
 *
 * Assumptions (documented, MVP): single user, single machine, no concurrent
 * processes. Writes are atomic (temp file + rename) so a crash mid-write won't
 * corrupt an existing job file.
 */
export class StateManager {
  readonly stateDir: string;
  private readonly jobsDir: string;
  private readonly historyFile: string;
  private readonly stagedFile: string;

  constructor(stateDir = "./.batch-state") {
    this.stateDir = stateDir;
    this.jobsDir = path.join(stateDir, "jobs");
    this.historyFile = path.join(stateDir, "history.jsonl");
    this.stagedFile = path.join(stateDir, "staged.json");
  }

  /** Ensure the state directory structure exists. */
  private async ensureDirs(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
  }

  private jobPath(batchId: string): string {
    // batchId is API-generated (msgbatch_...), safe as a filename, but guard anyway.
    const safe = batchId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    return path.join(this.jobsDir, `${safe}.json`);
  }

  /** Atomic write: write to a temp file, then rename over the target. */
  private async atomicWrite(target: string, data: string): Promise<void> {
    const tmp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data, "utf8");
    await rename(tmp, target);
  }

  /** Persist (create or overwrite) a job record. */
  async saveJob(job: JobRecord): Promise<void> {
    await this.ensureDirs();
    await this.atomicWrite(
      this.jobPath(job.batchId),
      JSON.stringify(job, null, 2),
    );
  }

  /** Load a job record by batch id, or null if not found. */
  async getJob(batchId: string): Promise<JobRecord | null> {
    const file = this.jobPath(batchId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(await readFile(file, "utf8")) as JobRecord;
    } catch {
      return null;
    }
  }

  /** List all job records, most recently created first. */
  async listJobs(): Promise<JobRecord[]> {
    if (!existsSync(this.jobsDir)) return [];
    const files = (await readdir(this.jobsDir)).filter((f) =>
      f.endsWith(".json"),
    );
    const jobs: JobRecord[] = [];
    for (const f of files) {
      try {
        jobs.push(
          JSON.parse(
            await readFile(path.join(this.jobsDir, f), "utf8"),
          ) as JobRecord,
        );
      } catch {
        // skip corrupt/partial files
      }
    }
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return jobs;
  }

  /** The most recently created job, or null if none. */
  async latestJob(): Promise<JobRecord | null> {
    const jobs = await this.listJobs();
    return jobs[0] ?? null;
  }

  /** Update the status fields on an existing job (no-op if not found). */
  async updateStatus(
    batchId: string,
    lastStatus: NonNullable<JobRecord["lastStatus"]>,
  ): Promise<void> {
    const job = await this.getJob(batchId);
    if (!job) return;
    job.lastStatus = lastStatus;
    job.lastCheckedAt = new Date().toISOString();
    await this.saveJob(job);
  }

  /** Append an entry to the history log. */
  async record(entry: Omit<HistoryEntry, "at">): Promise<void> {
    await this.ensureDirs();
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    // Append is atomic enough for single-writer; each line is self-contained.
    await writeFile(this.historyFile, line + "\n", { flag: "a" });
  }

  // --- staging (for the git-like CLI: add/review/send across invocations) ---

  /** Load the currently staged requests (empty array if none). */
  async loadStaged(): Promise<StagedRequest[]> {
    if (!existsSync(this.stagedFile)) return [];
    try {
      return JSON.parse(await readFile(this.stagedFile, "utf8")) as StagedRequest[];
    } catch {
      return [];
    }
  }

  /** Persist the full staging area (overwrites). */
  async saveStaged(staged: StagedRequest[]): Promise<void> {
    await this.ensureDirs();
    await this.atomicWrite(this.stagedFile, JSON.stringify(staged, null, 2));
  }

  /** Clear the staging area. */
  async clearStaged(): Promise<void> {
    if (existsSync(this.stagedFile)) {
      await this.atomicWrite(this.stagedFile, "[]");
    }
  }

  /** Read the full history log (empty if none). */
  async history(): Promise<HistoryEntry[]> {
    if (!existsSync(this.historyFile)) return [];
    const raw = await readFile(this.historyFile, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as HistoryEntry);
  }
}
