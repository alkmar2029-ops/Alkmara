# Sprint 6 v1 — UX Review

**Scope:** counselor operational report (م6.2) + school aggregate report (م6.3d) + sidebar integration.
**Framework:** Nielsen 10 heuristics + RTL/Arabic-specific observations.
**Method:** live walk-through on staging fixtures (smoke users), DOM/computed-style inspection, mobile + dark-mode resize, content-leak DOM scan.
**Date:** 2026-05-21.

This is a v1 polish pass — Sprint 6 v1 is already closed-ready. Items below are quality issues observed on the new surfaces, not Sprint 6 v1 blockers.

---

## Quick summary

| Severity | Count |
|---|---|
| 🔴 High | 2 |
| 🟡 Medium | 8 |
| 🟢 Low | 6 |

The new surfaces are **accessible and privacy-correct**. Almost all observations are about discoverability, consistency, and help/documentation — none are bugs, none weaken the privacy boundary.

---

## What works well (don't touch these)

These are intentional choices that landed cleanly and should not be "fixed" without explicit reason:

- **RTL + lang="ar"** on the root document, layout flips correctly across all surfaces.
- **Dark mode contrast** — body bg `#030712`, body text `#f3f4f6`, ~17:1 ratio (WCAG AAA). Card bg `#111827` distinguishable from body.
- **`طالب #N` fallback** — counselor top_5 with null names. Far better than "غير معروف"; reads as a deliberate ID reference, not a missing-data error.
- **Notes label "ملاحظاتك المسجلة"** + subtitle clarifying counselor-only scope. Prevents the most likely UX misread of m6.2.
- **"محجوب (n<5)" suppression badge + amber row tint + `—` dashes** on m6.3d. The principal sees that there's a privacy decision, not an empty cell.
- **No skip link, no `role="banner"` on header** — these are minor a11y absences, NOT covered up. Documented in the "Medium" section below.
- **Forbidden-key audits pass on both pages.** Documented in `sprint6-qa.md`. The UX work below MUST NOT regress these.

---

## 🔴 High — fix before any new surface launches

### H1 — Bucket boundaries are positional (m6.3d)

**Where:** м6.3d, by_grade table, "درجات المخاطر" column. Cells render as `376/2/0/0`. Header reads `(0-29/30-49/50-69/70+)`.

**Problem:** Reader must count positions to map cell to bucket. On the 4th row, "are these the 70+ count or the 50-69 count?" The cognitive load compounds when scanning multiple grades.

**Why high severity:** This is the most data-dense cell, AND it's the one the principal will most likely act on (high-risk students). Misreading the 70+ count vs the 30-49 count is a real harm — wrong escalation decisions.

**Suggested fix (low effort):**
- Option A (minimum): on hover, show a tooltip on each cell labeling the values: "0-29: 376 / 30-49: 2 / 50-69: 0 / 70+: 0".
- Option B (better): render the cell as inline labeled pairs: `0-29: 376 • 30-49: 2 • 50-69: 0 • 70+: 0`. Slightly wider, but no ambiguity.
- Option C (cleanest): use semantic labels parallel to severity — منخفضة / مرتفعة قليلًا / مرتفعة / حرجة — matching the case-severity vocabulary already in use elsewhere. The principal already knows what "حرجة" means.

The same fix applies to the cases cell `5/0/0/0` (افتُتحت / حُلَّت / أُغلقت / أُعيد فتحها) and plans cell, but these are less harmful to misread.

### H2 — No "help" affordance explaining k-anonymity (m6.3d)

**Where:** m6.3d, scope chip "k≥5" + "محجوب (n<5)" badge on suppressed rows.

**Problem:** A principal seeing a row with `—` in every metric column will, on first encounter, assume "no data". The badge helps but `n<5` is technical notation. The scope chip "k≥5" is even more technical. There's no inline explanation of WHY a row is suppressed.

**Why high severity:** Without context, the principal will either ignore the row (privacy decision fails to register) OR escalate to IT asking "why is grade X empty?" Both outcomes erode trust in the report.

**Suggested fix (low effort):**
- Replace badge text "محجوب (n<5)" with "محجوب — أقل من 5 طلاب نشطين".
- Replace scope chip "k≥5" with "حد الإخفاء: 5 طلاب".
- Add an info icon (ℹ) next to "توزيع حسب الصف" card title. On click/hover, shows a small popover:
  > "الصفوف التي لديها أقل من 5 طلاب نشطين تُحجَب تفاصيلها لحماية الخصوصية. هذا قرار سياسة، ليس خطأ في البيانات."

---

## 🟡 Medium — polish during next maintenance pass

### M1 — Touch targets below 44px on mobile (both pages)

**Where:** Refresh and Print buttons are 78×34px. 7 interactive elements total are below the recommended 44px touch target.

**Why:** Acceptable on desktop with mouse. On tablet/mobile it becomes hit-and-miss, especially the date input increment arrows.

**Fix:** Bump button vertical padding from `py-2` to `py-2.5` (38px → 42px). Same for the small quick-range pills if used on mobile. Or use `min-h-[44px]` only on `@media (pointer: coarse)`.

### M2 — Card title pattern inconsistent between pages

**Where:** м6.2 "الحالات" vs m6.3d "الحالات — كل المدرسة". The "— كل المدرسة" suffix is principal-specific but it's a recurring suffix that adds visual noise.

**Fix:** Drop the suffix from m6.3d card titles. The scope chip at the top already says "المدرسة كاملة • N طالب نشط". Repeating it on every card duplicates and slows scanning.

### M3 — No "reset" affordance for date range

**Where:** Both pages have date inputs + 3 quick-range pills, but no explicit way to return to the default 30-day rolling window after a user has explored a custom range.

**Fix:** The "آخر ٣٠ يوم" pill effectively IS the reset. Either:
- (a) Auto-highlight the active pill more strongly (it does already turn indigo, but the indigo is subtle), OR
- (b) Add a small "إعادة الافتراضي" link next to the date inputs that resets both inputs.

### M4 — Print button uses FileBarChart icon

**Where:** Both pages. The Print action's icon is the same FileBarChart used in the header gradient. Visual ambiguity.

**Fix:** Import `Printer` from lucide-react (already used in `app/dashboard/vp/operations-report/page.tsx`). Two-line change per page.

### M5 — Mobile date controls take 155px vertical space

**Where:** м6.2 + м6.3d on 375×812 (mobile preset).

**Why:** Labels + 2 inputs + 3 quick pills + invalid-range chip wrap into 3-4 rows of full-width content. Eats a third of the above-the-fold real estate.

**Fix:** On mobile (< sm breakpoint), collapse to a single `<details>` element with a summary like "الفترة: 2026-04-21 → 2026-05-21 (آخر 30 يوم)". Expand on tap. Saves ~80px.

### M6 — No skip-to-main-content link

**Where:** Whole app, not Sprint 6 specific — but matters for the new pages because they're long (3500px+ scroll).

**Fix:** Add a visually-hidden but focus-visible "تخطى إلى المحتوى الرئيسي" anchor in `app/dashboard/layout.tsx` linked to `<main id="main">`. Standard a11y pattern.

### M7 — No success feedback after refresh

**Where:** Refresh button spins while fetching, but on completion there's no confirmation (no toast, no checkmark transition).

**Why:** If the data didn't change (because the user picked the same date range), the user has no signal whether the refresh actually re-fetched.

**Fix:** Show a brief "تم التحديث" toast on successful refetch via the existing `react-hot-toast` system. Only when manually triggered, not on auto-refetch.

### M8 — Scope chip mixes Arabic + English+symbol

**Where:** м6.3d scope chips: "المدرسة كاملة • 984 طالب نشط" then "k≥5 • 2 صف محجوب".

**Why:** "k≥5" is a technical notation that doesn't read well in Arabic flow. Adding a small "•" between Arabic + English numerals is fine, but a Latin variable name like `k` in the middle of an Arabic chip is jarring.

**Fix:** "حد الخصوصية: 5 طلاب لكل صف". Or just drop the chip — the suppression badge on each row already conveys the policy.

---

## 🟢 Low — backlog candidates

### L1 — No CSV/JSON export from any report

Sprint 6.3 Exports track will address this. Documented in tech debt #15.

### L2 — No tooltip on top_5 score badges explaining the formula

The risk score formula (35% behavior + 25% engagement + 25% attendance + 15% velocity) lives only in the migration comment for `compute_student_risk_score`. A "?" icon next to "صورة المخاطر" card title with a popover would help.

### L3 — No keyboard shortcuts documented

App relies on visible controls only. Power users (counselors hitting the dashboard daily) would benefit from `g r` (go to reports), `j/k` (next/prev grade row), etc. Out of scope for Sprint 6.

### L4 — Refresh button looks the same in both states (fetching vs idle)

The icon spins but the button bg/border stays the same indigo. A subtle bg shift on hover OR a more pronounced "fetching..." text could reinforce the state.

### L5 — Page title (`<title>`) doesn't update per page

Both new pages render under the default `<title>` from `app/layout.tsx`. Browser tab + screen-reader announce nothing about which page is open.

**Fix:** Set `metadata.title` per page in the route file. Two-line addition.

### L6 — Compact `5/0/0/0` cells have no `<abbr>` or visually-hidden expansion

If the H1 fix above adds tooltips, this is covered. Standalone: add `aria-label="افتُتحت 5، حُلَّت 0، أُغلقت 0، أُعيد فتحها 0"` to the CompactCounts span so screen readers don't read "five slash zero slash zero".

---

## Items deliberately NOT changed

- **No `currently_active` for cases at school level** — privacy by design (point-in-time correlation). Won't add even with a tooltip explaining.
- **No top_5 in school report** — privacy by design. The principal asking "show me names" should be redirected to the counselor surface OR be told no, depending on the case.
- **No average_score in school report** — privacy by design. Buckets are the canonical view.
- **No by_type/by_severity inside grade rows** — privacy by design. School-level only.

These remain off-limits for any UI improvement that "would be nice to have."

---

## Per-heuristic scorecard (Nielsen 10)

| # | Heuristic | Score | Notes |
|---|---|---|---|
| 1 | Visibility of system status | 7/10 | Loading spinner + scope chip OK; no post-refresh confirmation (M7) |
| 2 | Match real world | 8/10 | Arabic labels everywhere; bucket boundaries numeric (H1) |
| 3 | User control & freedom | 7/10 | Date range editable; no explicit reset, no breadcrumb (M3) |
| 4 | Consistency & standards | 7/10 | Components consistent; card title suffix differs (M2), Print icon (M4) |
| 5 | Error prevention | 9/10 | Client-side guards + HTML5 min/max; >365 days hits server only |
| 6 | Recognition over recall | 6/10 | Compact cells require remembering header order (H1, L6) |
| 7 | Flexibility & efficiency | 6/10 | No shortcuts, no export, no power-user paths (L1, L3) |
| 8 | Aesthetic & minimalist | 7/10 | Clean; scope chip mixes scripts (M8); "n<5" technical (H2) |
| 9 | Recognize/diagnose errors | 8/10 | Arabic error messages clear; generic server-error fallback |
| 10 | Help & documentation | 4/10 | No inline help anywhere (H2, L2) — biggest weakness |

**Overall:** ~70/100 — strong base; help/docs and the bucket-readability issue are the two real polish wins.

---

## Suggested next pass (if and when prioritized)

If you decide to act on this, the highest-leverage fixes in order:

1. **H1 (bucket readability)** — tooltip or labeled-pair display. Same change pattern on cases/plans cells.
2. **H2 (k-anonymity explanation)** — replace technical notation with Arabic + add info popover.
3. **M2 (drop "— كل المدرسة" suffix)** — quick visual win.
4. **M4 (Printer icon)** — 2 lines, removes ambiguity.
5. **L5 (per-page `<title>`)** — 2 lines per page, accessibility win.

Total: ~half a day of work for a noticeably better v1.1.

The remaining items are good backlog candidates but not blocking anything.
