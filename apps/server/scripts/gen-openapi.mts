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
