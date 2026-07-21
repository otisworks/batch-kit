/**
 * Prompt template interpolation. Pure functions, no I/O — easy to unit test.
 */

export interface TemplateVars {
  content: string;
  filename: string;
  index: number;
}

/**
 * Interpolate `{content}`, `{filename}`, `{index}` into a template string.
 * Unknown `{tokens}` are left untouched.
 */
export function interpolate(template: string, vars: TemplateVars): string {
  return template
    .replaceAll("{content}", vars.content)
    .replaceAll("{filename}", vars.filename)
    .replaceAll("{index}", String(vars.index));
}

/**
 * Derive an API-safe custom_id from an index + filename.
 * The Batch API requires custom_id to match [a-zA-Z0-9_-] and be <=64 chars.
 */
export function toCustomId(index: number, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${index}_${safe}`.slice(0, 64);
}
