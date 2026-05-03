import type { NameMatch } from './types';

// Match teacher names from Excel against existing user_profiles rows.
// Arabic name variants (أ/إ/آ, ة/ه, ى/ي) and partial matches (first
// name only) are common in school spreadsheets, so we normalize and
// score rather than require exact equality.

export interface TeacherCandidate {
  user_id: string;
  full_name: string;
}

/**
 * Normalize an Arabic name for comparison:
 *   - collapse whitespace
 *   - remove diacritics (ـ ً ٌ ٍ َ ُ ِ ّ ْ)
 *   - unify alif variants (أ/إ/آ → ا)
 *   - unify ya/alif maqsura (ى → ي)
 *   - unify ta marbuta (ة → ه)
 *   - drop honorifics ("الأستاذ", "أ.", etc.)
 */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, '')     // tashkeel + tatweel
    .replace(/[أإآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/^(الأستاذ|الاستاذ|أ\.|ا\.|أستاذ|استاذ)\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return normalizeArabic(s).split(' ').filter(Boolean);
}

/**
 * Compute a similarity score between an Excel name and a candidate
 * full_name, in [0, 1]:
 *   1.0   exact match (after normalization)
 *   0.95  exact match on the first token of full_name (e.g., Excel
 *         "أحمد" matches "أحمد الشمراني")
 *   0.80  every Excel token appears as a token in full_name
 *   0.60  partial substring match
 *   0.0   no shared tokens at all
 */
function score(excelName: string, fullName: string): number {
  const a = normalizeArabic(excelName);
  const b = normalizeArabic(fullName);
  if (a === b) return 1.0;

  const aTokens = tokens(excelName);
  const bTokens = tokens(fullName);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  // Excel name is just the first token and matches the candidate's
  // first token? High signal — common pattern in school sheets.
  if (aTokens.length === 1 && aTokens[0] === bTokens[0]) return 0.95;

  // All Excel tokens are present somewhere in candidate tokens.
  const allFound = aTokens.every((t) => bTokens.includes(t));
  if (allFound) return 0.80;

  // Loose substring fallback.
  if (b.includes(a) || a.includes(b)) return 0.60;

  // At least one shared token gets a small score.
  const overlap = aTokens.filter((t) => bTokens.includes(t)).length;
  if (overlap > 0) return 0.50 * (overlap / Math.max(aTokens.length, bTokens.length));

  return 0;
}

/**
 * Match a single Excel name against the full pool of teacher
 * candidates. Returns up to 3 candidates ordered by descending score.
 *   • exact   — score === 1.0  (auto-link, no review needed)
 *   • partial — best candidate has score >= 0.6 but < 1.0
 *   • none    — no candidate scored >= 0.5
 */
export function matchTeacherName(
  excelName: string,
  pool: TeacherCandidate[],
): NameMatch {
  const scored = pool
    .map((c) => ({ ...c, score: score(excelName, c.full_name) }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  let status: NameMatch['status'];
  if (scored.length === 0) status = 'none';
  else if (scored[0].score >= 1.0) status = 'exact';
  else status = 'partial';

  return {
    excel_name: excelName,
    status,
    candidates: scored.map((c) => ({
      user_id: c.user_id,
      full_name: c.full_name,
      score: c.score,
    })),
  };
}

export function matchAllTeachers(
  excelNames: string[],
  pool: TeacherCandidate[],
): NameMatch[] {
  return excelNames.map((n) => matchTeacherName(n, pool));
}
