import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { updateSectionsBatchSchema, updateSectionsSchema } from '../lib/validations/schemas';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('project hardening contracts', () => {
  it('does not embed Supabase JWTs in the Vercel environment helper', () => {
    const source = read('scripts/set-vercel-env.js');
    assert.doesNotMatch(source, /eyJhbGci/);
    assert.match(source, /process\.env\[name\]/);
    assert.match(source, /shell: false/);
  });

  it('validates section count and duplicate grade updates', () => {
    const elevenSections = Array.from({ length: 11 }, (_, index) => ({
      name: String(index + 1),
      sort_order: index + 1,
    }));
    const tooMany = Array.from({ length: 31 }, (_, index) => ({
      name: String(index + 1),
      sort_order: index + 1,
    }));
    assert.equal(updateSectionsSchema.safeParse({ grade_id: 1, sections: elevenSections }).success, true);
    assert.equal(updateSectionsSchema.safeParse({ grade_id: 1, sections: tooMany }).success, false);
    assert.equal(updateSectionsBatchSchema.safeParse({
      updates: [
        { grade_id: 1, sections: [{ name: 'أ', sort_order: 1 }] },
        { grade_id: 1, sections: [{ name: 'ب', sort_order: 1 }] },
      ],
    }).success, false);
  });

  it('updates sections atomically and protects every foreign-key dependency', () => {
    const migration = read('supabase/migrations/20260828010000_harden_section_updates.sql');
    const expandedLimitMigration = read('supabase/migrations/20260828030000_expand_section_limit.sql');
    const route = read('app/api/sections/route.ts');
    const page = read('app/dashboard/grades/page.tsx');

    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.update_school_sections/);
    assert.match(migration, /pg_catalog\.pg_constraint/);
    assert.match(migration, /c\.confrelid = 'public\.sections'::regclass/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.update_school_sections\(JSONB\) FROM PUBLIC/);
    assert.match(expandedLimitMigration, /BETWEEN 1 AND 30/);
    assert.match(route, /supabase\.rpc\('update_school_sections'/);
    assert.match(route, /action: 'sections\.update'/);
    assert.match(page, /JSON\.stringify\(\{ updates \}\)/);
    assert.doesNotMatch(page, /Promise\.all\(promises\)/);
  });

  it('locks structural school settings after sections exist', () => {
    const route = read('app/api/settings/route.ts');
    const page = read('app/dashboard/settings/page.tsx');
    assert.match(route, /has_sections: \(sectionsCount \|\| 0\) > 0/);
    assert.match(route, /\(count \|\| 0\) > 0 && changesStructure/);
    assert.match(page, /disabled=\{settings\?\.has_sections\}/);
  });

  it('keeps sidebar ordering global, fixed, and super-admin controlled', () => {
    const layout = read('app/dashboard/layout.tsx');
    const route = read('app/api/settings/sidebar-order/route.ts');
    const migration = read('supabase/migrations/20260828020000_sidebar_order.sql');
    assert.match(layout, /DEFAULT_SIDEBAR_ORDER/);
    assert.match(layout, /draggable=\{isReordering && sidebarOpen\}/);
    assert.match(layout, /aria-expanded=\{!isCollapsed\}/);
    assert.match(layout, /SIDEBAR_COLLAPSED_GROUPS_KEY/);
    assert.match(layout, /grid-rows-\[0fr\]/);
    assert.match(layout, /تم تثبيت ترتيب القائمة لجميع المستخدمين/);
    assert.match(route, /auth\.ctx\.role !== 'super_admin'/);
    assert.match(migration, /BEFORE UPDATE OF sidebar_order/);
    assert.match(migration, /role = 'super_admin'/);
  });

  it('uses a real offline fallback and a stricter production CSP', () => {
    const worker = read('public/sw.js');
    const config = read('next.config.mjs');
    assert.match(worker, /'\/login'/);
    assert.doesNotMatch(worker, /\/teacher\/login/);
    assert.match(config, /process\.env\.NODE_ENV === 'production'/);
    assert.match(config, /object-src 'none'/);
    assert.match(config, /frame-ancestors 'none'/);
  });
});
