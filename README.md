# batch-kit

An ergonomic CLI + library for the [Anthropic Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing).

Process large volumes of documents with Claude at **50% off** the standard API cost — without hand-writing JSONL, tracking batch IDs, or reimplementing polling loops.

```bash
npx batch add --dir ./reviews --prompt "Summarize this review:\n\n{content}"
npx batch send
# ...later...
npx batch fetch --latest --output summaries.json
```

---

## Why

The Batch API is great for cost-effective bulk processing, but the raw developer experience is manual: you build the JSONL request shape yourself, poll for status, and track which batch is which. batch-kit wraps `@anthropic-ai/sdk` and handles all of that behind a familiar, git-like workflow.

## Requirements

- Node.js **18+**
- An `ANTHROPIC_API_KEY`

## Install

**As a local project dependency:**

```bash
npm install @otisworks/batch-kit
```

Run the CLI with `npx`:

```bash
npx batch <command>
```

**Or install globally** to use the bare `batch` command:

```bash
npm install -g @otisworks/batch-kit
batch <command>
```

> **Note:** With a local install, run commands as `npx batch ...`. The bare
> `batch` command only works after a global install (`npm i -g`). Without one,
> your shell may resolve `batch` to an unrelated system utility.
>
> The examples below use the bare `batch` command; prefix them with `npx` if
> you installed locally.

## Setup

Set your API key via environment variable or a `.env` file in your working directory:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The CLI automatically loads `.env` from the current directory.

---

## CLI

The CLI follows a git-like staged workflow: **add** documents, **review** them, **send** the batch, then **fetch** results.

### `batch add`

Stage documents from a directory using a prompt template.

```bash
batch add --dir ./documents --prompt "Summarize:\n\n{content}"
```

| Option | Description |
|---|---|
| `-d, --dir <dir>` | Directory of documents (required) |
| `-p, --prompt <template>` | Prompt template (required) |
| `-m, --model <model>` | Model override |
| `--max-tokens <n>` | `max_tokens` override |
| `-e, --ext <list>` | Comma-separated extensions, e.g. `.txt,.md` |

**Template variables:** `{content}` (file contents), `{filename}`, `{index}`.

Supported file types: `.txt` and `.md` by default.

### `batch review`

Preview what's currently staged.

```bash
batch review
```

### `batch reset`

Discard the staging area.

```bash
batch reset
```

### `batch send`

Submit staged documents as a single batch. Prints the batch ID and clears staging.

```bash
batch send            # submit and exit
batch send --wait     # block until processing finishes
```

### `batch status`

Check a batch's processing status and per-request counts.

```bash
batch status <batch-id>
batch status --latest    # most recently submitted batch
```

### `batch fetch`

Retrieve results. Results are matched back to their source filenames.

```bash
batch fetch <batch-id>
batch fetch --latest
batch fetch --latest --wait                  # wait for completion first
batch fetch --latest --output results.json   # write JSON to a file
```

| Option | Description |
|---|---|
| `-l, --latest` | Use the most recently submitted batch |
| `-o, --output <file>` | Write results as JSON |
| `-w, --wait` | Wait for completion before fetching |

### `batch history`

Show the operation log (send / status / fetch events).

```bash
batch history
```

### Global options

| Option | Description |
|---|---|
| `--state-dir <dir>` | State directory (default `./.batch-state`) |

---

## Example workflow

```bash
# Stage 50 customer reviews for summarization
batch add --dir ./reviews --prompt "Summarize this review in 2 sentences:\n\n{content}"

batch review
#   50 document(s) staged: ...

batch send
#   Batch submitted: msgbatch_01...

# (later — even from a fresh terminal)
batch status --latest
#   status: ended  counts: succeeded=50 ...

batch fetch --latest --output summaries.json
#   Wrote 50 result(s) to summaries.json (50 succeeded).
```

---

## Library

```typescript
import { BatchKit } from "@otisworks/batch-kit";

const kit = new BatchKit({
  apiKey: process.env.ANTHROPIC_API_KEY, // optional; defaults to env var
  stateDir: "./.batch-state",            // optional
});

// Stage documents
await kit.add("./documents", {
  prompt: "Extract keywords:\n\n{content}",
  model: "claude-opus-4-8",
  maxTokens: 1024,
});

// Preview
const { count, files } = await kit.review();

// Submit
const batchId = await kit.send();

// Wait for completion
await kit.wait(batchId, {
  onPoll: ({ status, counts }) => console.log(status, counts),
});

// Stream results (matched back to files via customId)
for await (const result of kit.results(batchId)) {
  if (result.type === "succeeded") {
    console.log(result.customId, result.text);
  }
}
```

Batch-id methods (`status`, `wait`, `results`) also accept the string `"latest"`
to target the most recently submitted batch.

See [`examples/programmatic.mjs`](./examples/programmatic.mjs) for a runnable example.

---

## How state works

batch-kit persists job metadata to a local `.batch-state/` directory:

```
.batch-state/
├── jobs/<batch-id>.json   # metadata + customId→filename map per batch
├── staged.json            # the current staging area
└── history.jsonl          # append-only operation log
```

This is what makes `--latest` and cross-session `fetch` work.

> **Note:** State is local to the machine and directory you run in (much like
> `.git/`). If you `send` on one machine, you'll need that machine's
> `.batch-state/` to resolve `--latest` later. The batch itself lives on
> Anthropic's servers regardless — you can always fetch by explicit batch ID.
>
> batch-kit assumes single-user, non-concurrent usage. Writes are atomic
> (temp file + rename) to avoid corruption on interruption.

---

## Development

```bash
npm install
npm run build       # compile TypeScript to dist/
npm test            # run unit tests (no API calls)
npm run typecheck   # type-check without emitting
```

## License

MIT
