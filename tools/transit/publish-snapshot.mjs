// GitHub Actions entry point. Secret is read from environment, never an argument or output.
import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDelhiHandler, SOURCE_URL } from './delhi-otd.mjs';

export async function collectSnapshot({ env = process.env, fetchImpl = fetch, clock = Date.now } = {}) {
  const handle = createDelhiHandler({ fetchImpl, clock });
  const response = await handle(new Request('https://collector.invalid/api/transit/delhi'), env);
  const data = await response.json();
  const snapshot = response.ok
    ? { ...data, status: 'ok', delivery: 'github-pages-snapshot', generated_at: new Date(clock()).toISOString() }
    : { schema_version: 1, source_id: 'delhi-otd', source_url: SOURCE_URL, status: data.status, delivery: 'github-pages-snapshot', generated_at: new Date(clock()).toISOString(), positions: [] };
  // Defence in depth: fail closed if an unexpected upstream identity contains the credential.
  const secret = env.DELHI_OTD_API_KEY;
  if (secret && JSON.stringify(snapshot).includes(secret)) {
    return { schema_version: 1, source_id: 'delhi-otd', source_url: SOURCE_URL, status: 'invalid_feed', delivery: 'github-pages-snapshot', generated_at: new Date(clock()).toISOString(), positions: [] };
  }
  return snapshot;
}

export async function writeSnapshot(output, options) {
  const snapshot = await collectSnapshot(options);
  const target = resolve(output), temp = target + '.tmp';
  await mkdir(dirname(target), { recursive: true });
  try { await writeFile(temp, JSON.stringify(snapshot) + '\n', { mode: 0o644 }); await rename(temp, target); }
  finally { await rm(temp, { force: true }); }
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output || process.argv.length !== 3) {
    process.stderr.write('Usage: node tools/transit/publish-snapshot.mjs OUTPUT_JSON\n'); process.exitCode = 1;
  } else {
    try {
      const snapshot = await writeSnapshot(output);
      // Only a controlled status and aggregate count; never log provider responses or IDs.
      process.stdout.write('Delhi snapshot: ' + snapshot.status + '; observations: ' + snapshot.positions.length + '\n');
    } catch (_) { process.stderr.write('Snapshot publication failed.\n'); process.exitCode = 1; }
  }
}
