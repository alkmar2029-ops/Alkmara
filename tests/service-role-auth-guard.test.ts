import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const apiRoot = join(process.cwd(), 'app', 'api');

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

// These endpoints intentionally use the service role before a user session exists.
// Keep this list narrow: every addition requires a security review and its own abuse controls.
const PUBLIC_SERVICE_ROLE_ROUTES = new Set([
  'admin-invites/validate/[code]/route.ts',
  'public/school-info/route.ts',
]);

// Approved gates authenticate a Supabase user/persona or a signed internal worker.
// This is deliberately a static tripwire, not a substitute for endpoint authorization tests.
const APPROVED_GATE = /(?:getAuthContext|require[A-Z][A-Za-z]+|isWorkerRequest|isValidWorkerSecret)\s*\(|\.auth\.getUser\s*\(/;

describe('service-role route authorization guard', () => {
  it('requires every service-role API route to contain an approved gate or explicit public allowlist entry', () => {
    const violations = routeFiles(apiRoot)
      .filter((file) => readFileSync(file, 'utf8').includes('createAdminSupabaseClient'))
      .filter((file) => {
        const route = relative(apiRoot, file).split(sep).join('/');
        return !PUBLIC_SERVICE_ROLE_ROUTES.has(route) && !APPROVED_GATE.test(readFileSync(file, 'utf8'));
      })
      .map((file) => relative(process.cwd(), file).split(sep).join('/'));

    assert.deepEqual(
      violations,
      [],
      `Service-role routes missing an approved authorization gate:\n${violations.join('\n')}`,
    );
  });
});
