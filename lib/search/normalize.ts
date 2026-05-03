// Mirror of the SQL normalize_search_text function so we can normalize
// the user's query before comparing — the DB column was stored
// pre-normalized, so a non-normalized query would never match.

export function normalizeSearch(s: string): string {
  if (!s) return '';
  return s
    .replace(/[ً-ْٰـ]/g, '')      // strip diacritics + tatweel
    .replace(/[أإآ]/g, 'ا')       // unify alif variants
    .replace(/ى/g, 'ي')           // ya ⊃ alif maqsura
    .replace(/ة/g, 'ه')           // ta marbuta → ha
    // Arabic-Indic digits → ASCII digits so ١٢٣ matches 123 in DB.
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect what the user is trying to do based on the query text. Lets
 * the search box act as a smart command bar — typing "1/3" should
 * navigate to that section, "+966..." should match by phone, etc.
 */
export type SearchIntent =
  | { type: 'student_id'; value: string }
  | { type: 'phone'; value: string }
  | { type: 'section'; grade: string; section: string }
  | { type: 'context'; keyword: 'absence' | 'escape' | 'late' | 'dismissal'; rest: string }
  | { type: 'plain'; value: string };

export function detectIntent(query: string): SearchIntent {
  const q = query.trim();
  if (!q) return { type: 'plain', value: '' };

  // 10 consecutive digits = student_id (Saudi national ID format)
  if (/^\d{10}$/.test(q.replace(/\D/g, '')) && q.replace(/\D/g, '').length === 10) {
    return { type: 'student_id', value: q.replace(/\D/g, '') };
  }

  // Phone pattern: +966xxxxxxxxx or 05xxxxxxxx
  const phoneClean = q.replace(/[^\d+]/g, '');
  if (/^(\+?966\d{9}|05\d{8})$/.test(phoneClean)) {
    return { type: 'phone', value: phoneClean };
  }

  // "1/3" or "الأول/3" → section reference
  const sectionMatch = q.match(/^(\d+|الأول|الاول|الثاني|الثالث|الرابع)\s*\/\s*(\d+)$/);
  if (sectionMatch) {
    return { type: 'section', grade: sectionMatch[1], section: sectionMatch[2] };
  }

  // Keyword prefixes — "غياب اسم"، "هروب"، إلخ.
  const lower = normalizeSearch(q);
  for (const [kw, key] of [
    ['غياب', 'absence'],
    ['غايب', 'absence'],
    ['هروب', 'escape'],
    ['تهرب', 'escape'],
    ['تاخر', 'late'],
    ['تأخر', 'late'],
    ['متأخر', 'late'],
    ['استئذان', 'dismissal'],
    ['استاذان', 'dismissal'],
  ] as const) {
    if (lower.startsWith(normalizeSearch(kw) + ' ') || lower === normalizeSearch(kw)) {
      const rest = lower.slice(normalizeSearch(kw).length).trim();
      return { type: 'context', keyword: key, rest };
    }
  }

  return { type: 'plain', value: q };
}
