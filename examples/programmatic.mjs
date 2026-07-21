// Programmatic usage of batch-kit (the library, not the CLI).
//
// Run from the project root after `npm run build`:
//   ANTHROPIC_API_KEY=sk-... node examples/programmatic.mjs
//
// Demonstrates the full lifecycle: add -> review -> send -> wait -> results.

import { BatchKit } from "../dist/index.js";

const kit = new BatchKit({
  // apiKey defaults to process.env.ANTHROPIC_API_KEY
  stateDir: "./.batch-state",
});

// 1. Stage documents with a prompt template.
const staged = await kit.add("./sample-docs", {
  prompt: "Summarize this in one sentence:\n\n{content}",
  maxTokens: 256,
});
console.log(`Staged ${staged} document(s).`);

// 2. Preview before sending.
const preview = await kit.review();
console.log(`Review: ${preview.count} docs -> ${preview.files.join(", ")}`);

// 3. Submit the batch.
const batchId = await kit.send();
console.log(`Submitted batch ${batchId}`);

// 4. Wait for completion (polls the API; batches can take minutes to hours).
await kit.wait(batchId, {
  onPoll: ({ status, counts }) =>
    console.log(`  ${status}: ${counts.succeeded} done, ${counts.processing} processing`),
});

// 5. Stream results. Match back to files via customId if needed.
for await (const result of kit.results(batchId)) {
  if (result.type === "succeeded") {
    console.log(`\n[${result.customId}]\n${result.text.trim()}`);
  } else {
    console.log(`\n[${result.customId}] ${result.type}`);
  }
}
