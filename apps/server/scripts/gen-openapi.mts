/**
 * Q2c (gap-audit D6/23): emit the OpenAPI document as a build-time artifact so
 * production consumers get a machine-readable spec without /docs (dev-only by
 * W3-4). Run: pnpm --filter @accessbase/server gen:openapi -> docs/openapi.json
 */
import { writeFileSync } from 'node:fs';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
process.env.DATABASE_URL ??= 'postgresql://localhost:5432/unused-for-schema-only';
process.env.JWT_SECRET ??= 'openapi-gen-only';
const { buildApp } = await import('../src/app.js');
const app = await buildApp();
await app.ready();
const spec = app.swagger();
writeFileSync(new URL('../../../docs/openapi.json', import.meta.url), JSON.stringify(spec, null, 2) + '\n');
await app.close();
console.log('docs/openapi.json written:', Object.keys(spec.paths ?? {}).length, 'paths');
// E19 (2026-11-09, measured): the process did not exit after close() - the first run had to
// be SIGTERM'd (rc=124) although the artifact was already written. Cause observed in the log,
// not inferred: with Redis unavailable the ioredis client retries forever
// ("connect ECONNREFUSED 127.0.0.1:6379" x3 + a MaxRetriesPerRequestError from the cache-
// coherence subscribe), so the event loop never drains - while spec emission is unaffected,
// because the document comes from route schemas only, not from live dependencies. Explicit
// termination after the synchronous write is what makes this usable as a regen-diff gate in
// dependency-free environments (CI has no Redis service for this job).
process.exit(0);
