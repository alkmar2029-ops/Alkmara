import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  getDefaultAcademicYearDates,
  getNextAcademicYearName,
  parseAcademicYearName,
  rolloverConfirmation,
} from '../lib/academic-years';
import { academicYearRolloverSchema } from '../lib/validations/schemas';

const read = (path: string) => readFileSync(resolve(path), 'utf8');

describe('academic year helpers', () => {
  it('accepts consecutive Gregorian year labels only', () => {
    assert.deepEqual(parseAcademicYearName('2026-2027'), { startYear: 2026, endYear: 2027 });
    assert.equal(parseAcademicYearName('2026-2028'), null);
    assert.equal(parseAcademicYearName('26-27'), null);
  });

  it('derives the next label, default dates, and exact confirmation', () => {
    assert.equal(getNextAcademicYearName('2025-2026'), '2026-2027');
    assert.deepEqual(getDefaultAcademicYearDates('2026-2027'), {
      startDate: '2026-08-01',
      endDate: '2027-07-31',
    });
    assert.equal(rolloverConfirmation('2026-2027'), 'فتح 2026-2027');
  });

  it('requires dates, idempotency, and an exact destructive confirmation', () => {
    const valid = {
      action: 'rollover',
      new_year_name: '2026-2027',
      start_date: '2026-08-01',
      end_date: '2027-07-31',
      confirmation: 'فتح 2026-2027',
      idempotency_key: '4b1a9a2d-1d68-4c35-8c69-f7054ab47b45',
    };
    assert.equal(academicYearRolloverSchema.safeParse(valid).success, true);
    assert.equal(academicYearRolloverSchema.safeParse({ ...valid, confirmation: 'نعم' }).success, false);
    assert.equal(academicYearRolloverSchema.safeParse({ ...valid, end_date: '2026-07-31' }).success, false);
    assert.equal(academicYearRolloverSchema.safeParse({ ...valid, new_year_name: '2026-2028' }).success, false);
  });
});

describe('academic year rollover contracts', () => {
  it('stores annual enrollment snapshots and runs the rollover atomically', () => {
    const migration = read('supabase/migrations/20260901010000_academic_year_rollover.sql');
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.academic_years/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.student_academic_year_enrollments/);
    assert.match(migration, /CREATE OR REPLACE FUNCTION public\.open_next_academic_year/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /idempotency_key UUID NOT NULL UNIQUE/);
    assert.match(migration, /status = 'graduated'/);
    assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.promote_students\(\)/);
  });

  it('blocks unsafe rollback after new-year activity', () => {
    const migration = read('supabase/migrations/20260901010000_academic_year_rollover.sql');
    assert.match(migration, /interval '24 hours'/);
    assert.match(migration, /new-year activity exists; rollback is blocked/);
    assert.match(migration, /student assignments changed after rollover/);
  });

  it('uses the annual workflow in the API and dashboard', () => {
    const route = read('app/api/academic-years/route.ts');
    const page = read('app/dashboard/promote/page.tsx');
    const settings = read('app/api/settings/route.ts');
    assert.match(route, /open_next_academic_year/);
    assert.match(route, /rollback_academic_year_rollover/);
    assert.match(route, /academic_year\.rollover/);
    assert.match(page, /إغلاق وفتح عام دراسي/);
    assert.match(page, /crypto\.randomUUID\(\)/);
    assert.match(page, /التراجع الآمن/);
    assert.match(settings, /يتم تغيير العام الدراسي من صفحة «فتح عام دراسي»/);
  });
});
