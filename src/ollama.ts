// Where the local model lives. Its own module because both the hatcher and the
// weaponsmith need it, and having the smith import it from the hatcher made a
// cycle — which typechecks perfectly and then leaves half the graph undefined
// at runtime, in the browser only, at the moment the first creature spawns.

export const HATCH_MODEL =
  (typeof process !== 'undefined' && process.env?.HATCH_MODEL) || 'llama3.2:3b';
export const OLLAMA_URL =
  (typeof process !== 'undefined' && process.env?.OLLAMA_URL) || 'http://localhost:11434';

/**
 * A deployed pit has no GPU and no `ollama serve`. Point these at any
 * OpenAI-compatible endpoint and the hatcher uses it instead. Never set in a
 * browser — the key would be public — so this is a server-side path only.
 */
export const HATCH_API_KEY =
  (typeof process !== 'undefined' && process.env?.HATCH_API_KEY) || '';
export const HATCH_API_URL =
  (typeof process !== 'undefined' && process.env?.HATCH_API_URL) || 'https://api.groq.com/openai/v1';
