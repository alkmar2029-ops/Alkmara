import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';

const routeSource = readFileSync(resolve('app/api/students/route.ts'), 'utf8');
const migrationSource = readFileSync(
  resolve('supabase/migrations/2026_08_22_001_students_list_query_indexes.sql'),
  'utf8',
);

describe('students list query performance contract', () => {
  it('applies blocked-pickup filtering in PostgreSQL before pagination', () => {
    assert.match(routeSource, /query\.eq\('has_blocked_pickup', true\)/);
    assert.match(routeSource, /query\.not\('social_info->blocked_pickup', 'eq', '\[\]'\)/);
    assert.doesNotMatch(routeSource, /blockedFiltered|social_info\?\.blocked_pickup/);
    assert.match(routeSource, /total: count \|\| 0/);
  });

  it('uses the normalized trigram search column and a unique page order', () => {
    assert.match(routeSource, /query\.ilike\('search_text'/);
    assert.match(routeSource, /\.order\('id', \{ ascending: true \}\)/);
    assert.doesNotMatch(routeSource, /student_id\.ilike/);
  });

  it('defines a safe generated flag and targeted partial indexes', () => {
    assert.match(migrationSource, /GENERATED ALWAYS AS/);
    assert.match(migrationSource, /jsonb_typeof\(social_info -> 'blocked_pickup'\) = 'array'/);
    assert.match(migrationSource, /students_active_blocked_pickup_page_idx/);
    assert.match(migrationSource, /students_active_grade_name_page_idx/);
    assert.match(migrationSource, /students_active_section_name_page_idx/);
  });
});
