// A fresh Ollama has no models in it, and the pit is the only thing on the
// private network that can talk to it. So the pit pulls its own model on boot:
// no public port on the model server, and a redeploy heals itself.
//
// The pull is slow (gigabytes) and must never block the pit from opening —
// the keeper should be walking around while its brain downloads.

export interface WarmState {
  ready: boolean;
  pulling: boolean;
  progress: string;
  error?: string;
}

export const warm: WarmState = { ready: false, pulling: false, progress: '' };

async function hasModel(url: string, model: string): Promise<boolean> {
  const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`tags ${res.status}`);
  const j: any = await res.json();
  const names: string[] = (j?.models ?? []).map((m: any) => String(m?.name ?? ''));
  // ollama reports "llama3.2:3b"; a bare "llama3.2" means ":latest"
  return names.some(n => n === model || n === `${model}:latest`);
}

export async function warmModel(url: string, model: string): Promise<void> {
  try {
    if (await hasModel(url, model)) {
      warm.ready = true;
      console.log(`[pit] ${model} is already here`);
      return;
    }
  } catch (e) {
    warm.error = `cannot reach the model server: ${(e as Error).message}`;
    console.error('[pit]', warm.error);
    return;
  }

  warm.pulling = true;
  console.log(`[pit] pulling ${model} — this takes a while`);
  try {
    const res = await fetch(`${url}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: model, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`pull ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', lastLog = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const j = JSON.parse(line);
          if (j.status) warm.progress = String(j.status);
          if (j.total && j.completed) {
            const pct = Math.round((j.completed / j.total) * 100);
            warm.progress = `${j.status} ${pct}%`;
            // log sparingly — this streams hundreds of lines a second
            if (pct >= lastLog + 10) { lastLog = pct; console.log(`[pit] ${warm.progress}`); }
          }
        } catch { /* a partial line */ }
      }
    }
    warm.ready = await hasModel(url, model);
    warm.progress = warm.ready ? 'ready' : 'pull finished but the model is not there';
    console.log(`[pit] ${model}: ${warm.progress}`);
  } catch (e) {
    warm.error = (e as Error).message;
    console.error('[pit] pull failed:', warm.error);
  } finally {
    warm.pulling = false;
  }
}
