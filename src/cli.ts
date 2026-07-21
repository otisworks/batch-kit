#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { BatchKit } from "./BatchKit.js";
import type { BatchResult } from "./types.js";

// --- minimal .env loader (Node 18 has no --env-file) ---
function loadDotenv(): void {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const key = m[1]!;
    const val = (m[2] ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

function makeKit(stateDir?: string): BatchKit {
  loadDotenv();
  try {
    return new BatchKit(stateDir ? { stateDir } : {});
  } catch (err) {
    fail((err as Error).message);
  }
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const program = new Command();

program
  .name("batch")
  .description("Ergonomic CLI for the Anthropic Message Batches API")
  .version("0.0.1")
  .option("--state-dir <dir>", "directory for persisted state", "./.batch-state");

function stateDir(): string {
  return program.opts().stateDir as string;
}

// --- add ---
program
  .command("add")
  .description("Stage documents from a directory with a prompt template")
  .requiredOption("-d, --dir <dir>", "directory of documents")
  .requiredOption("-p, --prompt <template>", "prompt template ({content}, {filename}, {index})")
  .option("-m, --model <model>", "model override")
  .option("--max-tokens <n>", "max_tokens override", (v) => parseInt(v, 10))
  .option("-e, --ext <extensions>", "comma-separated extensions (e.g. .txt,.md)")
  .action(async (opts) => {
    const kit = makeKit(stateDir());
    try {
      const n = await kit.add(opts.dir, {
        prompt: opts.prompt,
        model: opts.model,
        maxTokens: opts.maxTokens,
        extensions: opts.ext
          ? opts.ext.split(",").map((e: string) => (e.startsWith(".") ? e : `.${e}`).toLowerCase())
          : undefined,
      });
      const { count } = await kit.review();
      console.log(`Staged ${n} document(s). ${count} total staged.`);
    } catch (err) {
      fail((err as Error).message);
    }
  });

// --- review ---
program
  .command("review")
  .description("Preview what's currently staged")
  .action(async () => {
    const kit = makeKit(stateDir());
    const { count, files } = await kit.review();
    if (count === 0) {
      console.log("Nothing staged. Use `batch add` first.");
      return;
    }
    console.log(`${count} document(s) staged:`);
    for (const f of files) console.log(`  - ${f}`);
  });

// --- reset ---
program
  .command("reset")
  .description("Discard the staging area")
  .action(async () => {
    const kit = makeKit(stateDir());
    await kit.reset();
    console.log("Staging cleared.");
  });

// --- send ---
program
  .command("send")
  .description("Submit staged documents as a batch")
  .option("-w, --wait", "block until the batch finishes")
  .action(async (opts) => {
    const kit = makeKit(stateDir());
    let id: string;
    try {
      id = await kit.send();
    } catch (err) {
      fail((err as Error).message);
    }
    console.log(`Batch submitted: ${id}`);
    if (opts.wait) {
      console.log("Waiting for completion...");
      await kit.wait(id, {
        onPoll: ({ status, counts }) =>
          console.log(`  ${status} (succeeded=${counts.succeeded} processing=${counts.processing} errored=${counts.errored})`),
      });
      console.log("Done. Use `batch fetch --latest` to retrieve results.");
    } else {
      console.log("Check later with `batch status --latest` and `batch fetch --latest`.");
    }
  });

// --- status ---
program
  .command("status [batchId]")
  .description("Check batch status (use --latest for the most recent)")
  .option("-l, --latest", "use the most recently submitted batch")
  .action(async (batchId, opts) => {
    const kit = makeKit(stateDir());
    const target = opts.latest ? "latest" : batchId;
    if (!target) fail("provide a batchId or use --latest");
    try {
      const s = await kit.status(target);
      console.log(`Batch ${s.batchId}`);
      console.log(`  status: ${s.status}`);
      const c = s.counts;
      console.log(`  counts: succeeded=${c.succeeded} processing=${c.processing} errored=${c.errored} canceled=${c.canceled} expired=${c.expired}`);
      if (s.endedAt) console.log(`  ended: ${s.endedAt}`);
    } catch (err) {
      fail((err as Error).message);
    }
  });

// --- fetch ---
program
  .command("fetch [batchId]")
  .description("Fetch results (use --latest for the most recent)")
  .option("-l, --latest", "use the most recently submitted batch")
  .option("-o, --output <file>", "write results as JSON to a file")
  .option("-w, --wait", "wait for completion before fetching")
  .action(async (batchId, opts) => {
    const kit = makeKit(stateDir());
    const target = opts.latest ? "latest" : batchId;
    if (!target) fail("provide a batchId or use --latest");

    try {
      const resolvedId = await kit.resolveBatchId(target);
      const job = await kit.store.getJob(resolvedId);
      const fileFor = new Map((job?.requests ?? []).map((r) => [r.customId, r.filename]));

      if (opts.wait) {
        console.log("Waiting for completion...");
        await kit.wait(resolvedId, {
          onPoll: ({ status, counts }) =>
            console.log(`  ${status} (succeeded=${counts.succeeded} processing=${counts.processing})`),
        });
      }

      const collected: Array<{ customId: string; file: string; type: BatchResult["type"]; text?: string }> = [];
      let ok = 0;
      for await (const r of kit.results(resolvedId)) {
        const file = fileFor.get(r.customId) ?? r.customId;
        const entry: { customId: string; file: string; type: BatchResult["type"]; text?: string } = {
          customId: r.customId,
          file,
          type: r.type,
        };
        if (r.type === "succeeded") {
          entry.text = r.text;
          ok++;
        }
        collected.push(entry);
      }

      if (opts.output) {
        await writeFile(opts.output, JSON.stringify(collected, null, 2), "utf8");
        console.log(`Wrote ${collected.length} result(s) to ${opts.output} (${ok} succeeded).`);
      } else {
        for (const e of collected) {
          console.log(`\n--- ${e.file} [${e.type}] ---`);
          if (e.text) console.log(e.text.trim());
        }
        console.log(`\n${ok}/${collected.length} succeeded.`);
      }
    } catch (err) {
      fail((err as Error).message);
    }
  });

// --- history ---
program
  .command("history")
  .description("Show the operation log")
  .action(async () => {
    const kit = makeKit(stateDir());
    const entries = await kit.store.history();
    if (entries.length === 0) {
      console.log("No history yet.");
      return;
    }
    for (const h of entries) {
      console.log(`${h.at}  ${h.op.padEnd(6)}  ${h.batchId}${h.detail ? "  (" + h.detail + ")" : ""}`);
    }
  });

program.parseAsync().catch((err) => fail((err as Error).message));
