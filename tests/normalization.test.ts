import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizePhone, toLatinDigits } from '../lib/phone/normalize';
import { detectIntent, normalizeSearch } from '../lib/search/normalize';

describe('phone normalization', () => {
  it('converts both Arabic digit sets to Latin digits', () => {
    assert.equal(toLatinDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
    assert.equal(toLatinDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  });

  it('normalizes common Saudi mobile formats', () => {
    assert.equal(normalizePhone('٠٥٥ ١٢٣ ٤٥٦٧'), '966551234567');
    assert.equal(normalizePhone('+966 55 123 4567'), '966551234567');
    assert.equal(normalizePhone('551234567'), '966551234567');
  });
});

describe('Arabic search normalization and intent', () => {
  it('normalizes diacritics, letter variants, digits, and whitespace', () => {
    assert.equal(normalizeSearch('  أَحْمَد  مدرسة ١٢٣ '), 'احمد مدرسه 123');
  });

  it('detects IDs, phone numbers, sections, and context keywords', () => {
    assert.deepEqual(detectIntent('1234567890'), { type: 'student_id', value: '1234567890' });
    assert.deepEqual(detectIntent('0551234567'), { type: 'phone', value: '0551234567' });
    assert.deepEqual(detectIntent('الأول / 3'), { type: 'section', grade: 'الأول', section: '3' });
    assert.deepEqual(detectIntent('تأخر أحمد'), { type: 'context', keyword: 'late', rest: 'احمد' });
  });
});
