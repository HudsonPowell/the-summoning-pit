// Where the local model lives. Its own module because both the hatcher and the
// weaponsmith need it, and having the smith import it from the hatcher made a
// cycle — which typechecks perfectly and then leaves half the graph undefined
// at runtime, in the browser only, at the moment the first creature spawns.

export const HATCH_MODEL =
  (typeof process !== 'undefined' && process.env?.HATCH_MODEL) || 'llama3.2:3b';
export const OLLAMA_URL =
  (typeof process !== 'undefined' && process.env?.OLLAMA_URL) || 'http://localhost:11434';
