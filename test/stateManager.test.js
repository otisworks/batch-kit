import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StateManager } from "../dist/stateManager.js";

let dir;
let s;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "batchkit-test-"));
  s = new StateManager(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const job = (id, createdAt, extra = {}) => ({
  batchId: id,
  createdAt,
  model: "claude-opus-4-8",
  requestCount: 1,
  requests: [{ customId: "0_a_txt", filename: "a.txt" }],
  lastStatus: "in_progress",
  ...extra,
});

test("saveJob + getJob round-trips", async () => {
  await s.saveJob(job("msgbatch_A", "2026-01-01T00:00:00.000Z"));
  const loaded = await s.getJob("msgbatch_A");
  assert.equal(loaded.batchId, "msgbatch_A");
  assert.equal(loaded.requests[0].filename, "a.txt");
});

test("getJob returns null for missing", async () => {
  assert.equal(await s.getJob("nope"), null);
});

test("listJobs sorts newest-first by createdAt", async () => {
  await s.saveJob(job("msgbatch_OLD", "2026-01-01T00:00:00.000Z"));
  await s.saveJob(job("msgbatch_NEW", "2026-06-01T00:00:00.000Z"));
  const list = await s.listJobs();
  assert.equal(list.length, 2);
  assert.equal(list[0].batchId, "msgbatch_NEW");
});

test("latestJob returns most recent", async () => {
  await s.saveJob(job("msgbatch_OLD", "2026-01-01T00:00:00.000Z"));
  await s.saveJob(job("msgbatch_NEW", "2026-06-01T00:00:00.000Z"));
  const latest = await s.latestJob();
  assert.equal(latest.batchId, "msgbatch_NEW");
});

test("latestJob returns null when empty", async () => {
  assert.equal(await s.latestJob(), null);
});

test("updateStatus persists status + timestamp", async () => {
  await s.saveJob(job("msgbatch_A", "2026-01-01T00:00:00.000Z"));
  await s.updateStatus("msgbatch_A", "ended");
  const loaded = await s.getJob("msgbatch_A");
  assert.equal(loaded.lastStatus, "ended");
  assert.equal(typeof loaded.lastCheckedAt, "string");
});

test("updateStatus is a no-op for missing job", async () => {
  await s.updateStatus("ghost", "ended"); // should not throw
  assert.equal(await s.getJob("ghost"), null);
});

test("history records and reads back with timestamps", async () => {
  await s.record({ op: "send", batchId: "msgbatch_A", detail: "3 requests" });
  await s.record({ op: "fetch", batchId: "msgbatch_A" });
  const h = await s.history();
  assert.equal(h.length, 2);
  assert.equal(h[0].op, "send");
  assert.equal(h[0].detail, "3 requests");
  assert.equal(typeof h[0].at, "string");
});

test("history is empty when nothing recorded", async () => {
  assert.deepEqual(await s.history(), []);
});

test("staging round-trips and clears", async () => {
  const staged = [
    { customId: "0_a_txt", filename: "a.txt", prompt: "p", model: "m", maxTokens: 10 },
  ];
  await s.saveStaged(staged);
  assert.deepEqual(await s.loadStaged(), staged);
  await s.clearStaged();
  assert.deepEqual(await s.loadStaged(), []);
});

test("loadStaged returns empty array when none", async () => {
  assert.deepEqual(await s.loadStaged(), []);
});
