# batch-kit: Anthropic Batch API Wrapper

## Project Overview

**batch-kit** is an npm package that wraps the `@anthropic-ai/sdk` to provide an ergonomic CLI + programmatic interface for processing large volumes of documents with Claude using the Anthropic Message Batches API.

Instead of manually building JSONL, tracking batch IDs, and implementing polling loops, users can:
- Drop documents in a directory
- Define a prompt template
- Run a simple CLI command
- Get results back when ready

**Target users:** Developers and teams doing bulk document processing (summarization, classification, extraction, analysis) who want the 50% cost savings of the Batch API without the operational overhead.

---

## Problem Statement

The Anthropic Batch API is powerful for cost-effective bulk processing, but **the developer experience is manual and error-prone**:

1. **JSONL formatting is tedious** — Users must manually construct the request shape for each document
2. **Polling is boilerplate** — Every project re-implements the same "check status every N seconds" loop
3. **State management is fragile** — Tracking which batches are running, which failed, where to save results is on the developer
4. **No CLI convenience** — No standardized way to submit batches or retrieve results without writing code
5. **No existing TypeScript wrapper** — The Python ecosystem has `anthropic-batch-kit`, but TypeScript is left hanging

---

## Proposed Solution

A dual-interface npm package:

### 1. **CLI Tool** (`batch` command)
Familiar git-like workflow with staged changes:

```bash
# Stage documents and prompt
batch add --dir ~/documents --prompt "Summarize this document:\n{content}"

# Preview what will be sent
batch review

# Submit to API
batch send

# Check status later
batch status <job-id>
batch status --latest  # Most recent job

# Fetch and parse results
batch fetch <job-id> --output ~/results
batch fetch --latest
```

### 2. **Programmatic Library**
For Node.js projects:

```typescript
import { BatchKit } from "@otisworks/batch-kit";

const kit = new BatchKit({
  apiKey: process.env.ANTHROPIC_API_KEY,
  stateDir: "./.batch-state" // Persists job tracking
});

// Add documents
await kit.add("./documents", {
  prompt: "Analyze: {content}",
  model: "claude-opus-4-8",
  maxTokens: 1024
});

// Preview before sending
const preview = await kit.review();
console.log(`${preview.count} documents, ~${preview.estimatedTokens} tokens`);

// Send batch
const jobId = await kit.send();
console.log(`Batch ${jobId} submitted`);

// Poll for completion
await kit.wait(jobId); // Blocks until done (or timeout)

// Stream results
for await (const result of kit.results(jobId)) {
  if (result.type === "succeeded") {
    console.log(`${result.customId}: ${result.message.content[0].text}`);
  }
}
```

---

## Core Features

### Stage 1: MVP
- ✅ CLI: `add`, `review`, `send`, `status`, `fetch`
- ✅ Automatic JSONL construction from files + prompt template
- ✅ Local state persistence (batch IDs, tracking)
- ✅ Simple polling loop with configurable interval/timeout
- ✅ Results streaming (memory-efficient)
- ✅ Support for `.txt`, `.md`, `.pdf` files (basic text extraction)
- ✅ Template variables: `{content}`, `{filename}`, `{index}`

### Stage 2: Enhancements
- File glob patterns for selective inclusion
- Retry logic for failed requests
- Batch result aggregation (CSV export, JSON summary)
- Config file support (`.batchrc` or `batch.config.json`)
- Progress reporting with spinner/progress bar
- Webhook notifications (Slack, Discord) when batch completes
- Cost estimation before sending

### Stage 3: Advanced
- Parallel batch submission (split large jobs into multiple batches)
- Prompt templating engine (Handlebars/Nunjucks)
- Result filtering/querying
- Integration with common data sources (S3, Google Drive)
- Web dashboard for viewing batch history

---

## Technical Architecture

### Dependencies
- `@anthropic-ai/sdk` — Official Anthropic SDK
- `commander.js` — CLI argument parsing
- `chalk` / `ora` — Terminal colors & spinners
- `pdfparse` or `pdf-parse` — Optional PDF text extraction
- `fs/promises` — File I/O
- `node:path` — Path utilities

### File Structure
```
batch-kit/
├── src/
│   ├── cli.ts                 # CLI entry point
│   ├── core/
│   │   ├── BatchKit.ts        # Main class
│   │   ├── stateManager.ts    # Persist batch metadata
│   │   └── fileProcessor.ts   # Load & extract text from docs
│   ├── utils/
│   │   ├── template.ts        # Prompt template interpolation
│   │   ├── polling.ts         # Batch status polling
│   │   └── resultsParser.ts   # JSONL → JS objects
│   └── types.ts               # TypeScript interfaces
├── bin/
│   └── batch.js               # Executable entry point
├── package.json
└── README.md
```

### State Persistence
State stored in `.batch-state/` (or configurable):
```
.batch-state/
├── config.json                # Default settings
├── jobs/
│   ├── msgbatch_01HkcT...json # Batch metadata & results cache
│   └── msgbatch_01HkcU...json
└── history.jsonl              # Append-only log of operations
```

---

## User Workflows

### Workflow 1: Simple Document Summarization
```bash
# I have 50 customer reviews I want summarized
batch add --dir ~/reviews --prompt "Summarize this review in 2 sentences:\n{content}"
batch review
# Shows: 50 documents, ~15k tokens estimated

batch send
# Batch msgbatch_01HkcT... submitted!

# (next morning, check results)
batch fetch --latest --output ~/summaries.json
```

### Workflow 2: Classification Pipeline
```bash
# Classify tickets as bug/feature/support
batch add ./tickets --prompt "Classify as bug/feature/support:\n{content}"
batch send --wait  # Block until done

# Results are already fetched
cat .batch-state/jobs/msgbatch_*/results.json
```

### Workflow 3: Programmatic (Node.js App)
```typescript
const kit = new BatchKit();
await kit.add("./data", { prompt: "Extract keywords: {content}" });
const jobId = await kit.send();
await kit.wait(jobId);

// Process results in-memory
const results = [];
for await (const r of kit.results(jobId)) {
  if (r.type === "succeeded") {
    results.push({ file: r.customId, output: r.message.content[0].text });
  }
}
```

---

## Success Criteria

- [ ] CLI is intuitive and requires zero documentation to understand basic workflow
- [ ] Can process 100+ documents without memory issues (streaming results)
- [ ] Batch state persists reliably across sessions
- [ ] Supports at least `.txt`, `.md`, `.pdf` file types
- [ ] Error handling is graceful (clear messages for auth errors, validation errors, etc.)
- [ ] Code is well-tested (unit tests for template engine, state manager; integration tests for CLI)
- [ ] Published to npm with clear README and examples

---

## Open Questions / Design Decisions

1. **Default prompt handling** — Should there be a built-in library of prompts (summarize, classify, extract) or is it user-defined only? → **MVP: User-defined only. Stage 2: Built-in library**

2. **Batch size limits** — Should the tool auto-split large jobs into multiple batches (100k limit)? → **MVP: Error if over limit. Stage 2: Auto-split**

3. **Retry strategy** — How aggressive should retries be for failed requests? → **MVP: No automatic retry. Stage 2: Configurable retry**

4. **Result format** — Always JSONL, or support CSV/JSON export? → **MVP: JSONL + stream. Stage 2: Add export formats**

5. **Async handling** — Should `--wait` be the default or opt-in? → **MVP: Opt-in (--wait flag), default is "submit and exit"**

6. **Config file location** — `.batchrc`, `batch.config.json`, or `package.json` key? → **MVP: Just CLI flags. Stage 2: Support config file**

---

## Similar Projects / Inspiration

- **anthropic-batch-kit** (Python) — Reference for API interaction patterns
- **git** — CLI UX model (add/commit/push workflow)
- **temporal** — Durability + workflow orchestration (Stage 3 inspiration)
- **node-glob** — File pattern matching

---

## Rough Timeline

- **Week 1-2:** Core BatchKit class, state manager, file processor
- **Week 2-3:** CLI scaffolding, `add`/`review`/`send` commands
- **Week 3-4:** Polling, results streaming, basic tests
- **Week 4:** Polish, error handling, documentation, npm publish

*Actual timeline depends on time investment & scope creep 😅*

---

## Notes for Implementation

- TypeScript throughout (no JS)
- Handle both CJS and ESM imports
- Comprehensive error messages (don't just throw API errors, wrap them)
- Add debug mode (`DEBUG=batch-kit:*`)
- Consider TypeScript SDK version compatibility
- Test against multiple Node versions (18+)

---

## Why This Matters

**For users:**
- Cut 50% off Batch API costs with actual ease of use
- Go from "I could use batches but it's annoying" to "I batch everything"

**For Anthropic ecosystem:**
- Fill a gap in TypeScript tooling (Python has it, TS doesn't)
- De-risk batch adoption by hiding complexity

**For you:**
- Legitimately useful tool you can open-source or productize
- Fun to build, learnable project scope
- Good portfolio piece
