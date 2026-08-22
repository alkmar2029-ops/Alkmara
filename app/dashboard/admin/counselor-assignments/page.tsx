// /dashboard/admin/counselor-assignments — manage which grades and
// sections each counselor sees. Matrix view with counselors as rows,
// grades + their sections as columns. Clicking a cell toggles the
// assignment (POST if empty, DELETE if present).
//
// Design notes (Codex review م1.7e):
//   - grade-wide vs section-specific are kept visually distinct. The
//     "كل الصف" cell sits in its own column inside each grade group,
//     with a subtle background, so admins can tell the two assignment
//     types apart at a glance.
//   - The schema allows BOTH a grade-wide assignment AND a section
//     assignment under the same grade for the same counselor. We don't
//     block it here — just display each cell independently. Reviewing
//     that overlap as confusing-vs-intentional is a UX call for a
//     later iteration, not a hard constraint now.
//   - Optimistic update + rollback (same pattern as م1.7d).
//   - Empty state when no counselors exist: deep-link to /dashboard/
//     admin/personas so the admin can promote someone first.
//
// Consumes:
//   - GET    /api/admin/personas              (filter persona='counselor')
//   - GET    /api/admin/counselor-assignments (existing assignments)
//   - GET    /api/grades, /api/sections       (matrix columns)
//   - POST   /api/admin/counselor-assignments (create)
//   - DELETE /api/admin/counselor-assignments/[id] (delete)

'use client';

import { useMemo, Fragment } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Loader2, AlertTriangle, ShieldAlert, Check, UserPlus, Globe2,
} from 'lucide-react';
import type { PersonaListItem } from '@/lib/personas/types';

interface Grade {
  id: number;
  name: string;
}

interface Section {
  id: number;
  name: string;
  grade_id: number;
}

interface Assignment {
  id: number;
  counselor_user_id: string;
  grade_id: number | null;
  section_id: number | null;
  assigned_at: string;
}

// Compact counselor row — the fields we actually render.
interface Counselor {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

// Key shape used in the assignmentsMap. Either grade_id or section_id
// is set (XOR enforced by DB CHECK + API Zod), so the key is unique
// per (counselor, scope).
function assignmentKey(counselor_user_id: string, grade_id: number | null, section_id: number | null): string {
  return `${counselor_user_id}:${grade_id ?? 'g'}:${section_id ?? 's'}`;
}

// ===========================================================================
// Main page
// ===========================================================================
export default function CounselorAssignmentsPage() {
  // --- Queries ---
  const personasQuery = useQuery<PersonaListItem[]>({
    queryKey: ['personas-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/personas');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل جلب المرشدين (${r.status})`);
      }
      return (await r.json()).data ?? [];
    },
    staleTime: 30_000,
  });

  const assignmentsQuery = useQuery<Assignment[]>({
    queryKey: ['counselor-assignments-list'],
    queryFn: async () => {
      const r = await fetch('/api/admin/counselor-assignments');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل جلب الإسنادات (${r.status})`);
      }
      // API embeds grade/section/counselor info, but we only need the
      // core ids for cell toggling; names come from the parallel
      // grades/sections queries which we cache for longer.
      const rows = (await r.json()).data ?? [];
      return rows.map((r: any) => ({
        id: r.id,
        counselor_user_id: r.counselor_user_id,
        grade_id: r.grade_id,
        section_id: r.section_id,
        assigned_at: r.assigned_at,
      }));
    },
    staleTime: 30_000,
  });

  // Grades/sections are PRIMARY axes of the matrix. If they fail to
  // load we want a real error state, not an empty-list fallback that
  // renders "لا توجد صفوف" (which looks like school misconfiguration
  // rather than a network/auth fault). Codex review م1.7e.
  const gradesQuery = useQuery<Grade[]>({
    queryKey: ['grades-list'],
    queryFn: async () => {
      const r = await fetch('/api/grades');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل جلب الصفوف (${r.status})`);
      }
      return (await r.json()).data ?? [];
    },
    staleTime: 10 * 60_000,
  });

  const sectionsQuery = useQuery<Section[]>({
    queryKey: ['sections-list-for-counselor'],
    queryFn: async () => {
      const r = await fetch('/api/sections');
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل جلب الشعب (${r.status})`);
      }
      return (await r.json()).data ?? [];
    },
    staleTime: 10 * 60_000,
  });

  // --- Derived ---
  const counselors: Counselor[] = useMemo(() => {
    if (!personasQuery.data) return [];
    return personasQuery.data
      .filter((u) => u.persona === 'counselor')
      .map((u) => ({
        user_id: u.user_id,
        full_name: u.full_name,
        email: u.email,
      }));
  }, [personasQuery.data]);

  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const grades = gradesQuery.data ?? [];
  const sections = useMemo(() => sectionsQuery.data ?? [], [sectionsQuery.data]);

  const sectionsByGrade = useMemo(() => {
    const m = new Map<number, Section[]>();
    for (const s of sections) {
      const arr = m.get(s.grade_id) ?? [];
      arr.push(s);
      m.set(s.grade_id, arr);
    }
    // Sort sections within each grade by name for stable display.
    for (const arr of m.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
    return m;
  }, [sections]);

  const assignmentsMap = useMemo(() => {
    const m = new Map<string, Assignment>();
    for (const a of assignments) {
      m.set(assignmentKey(a.counselor_user_id, a.grade_id, a.section_id), a);
    }
    return m;
  }, [assignments]);

  // Counselors with zero assignments — surfaced as a soft warning so
  // admins notice they're effectively non-functional until scoped.
  const unscopedCounselors = useMemo(() => {
    if (counselors.length === 0) return new Set<string>();
    const scoped = new Set(assignments.map((a) => a.counselor_user_id));
    return new Set(counselors.filter((c) => !scoped.has(c.user_id)).map((c) => c.user_id));
  }, [counselors, assignments]);

  // --- Mutations (optimistic + rollback, same pattern as م1.7d) ---
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (vars: {
      counselor_user_id: string;
      grade_id?: number;
      section_id?: number;
    }) => {
      const r = await fetch('/api/admin/counselor-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vars),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل الإسناد (${r.status})`);
      }
      return (await r.json()).data as Assignment;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['counselor-assignments-list'] });
      const previous = queryClient.getQueryData<Assignment[]>(['counselor-assignments-list']);
      // Temp negative id so we can identify the optimistic row if we
      // need to swap it on success (we just invalidate, so swap isn't
      // strictly required — but the negative id is a clear marker).
      const tempId = -Date.now();
      queryClient.setQueryData<Assignment[]>(['counselor-assignments-list'], (old) => [
        ...(old ?? []),
        {
          id: tempId,
          counselor_user_id: vars.counselor_user_id,
          grade_id: vars.grade_id ?? null,
          section_id: vars.section_id ?? null,
          assigned_at: new Date().toISOString(),
        },
      ]);
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['counselor-assignments-list'], context.previous);
      }
      toast.error(err instanceof Error ? err.message : 'فشل الإسناد');
    },
    onSuccess: (_data, vars) => {
      // Friendly toast: "تم إسناد <اسم المرشد> إلى <اسم الصف/الشعبة>".
      // Lookups fall back to generic labels if the cache misses — never
      // throws or hides the toast.
      const counselor = counselors.find((c) => c.user_id === vars.counselor_user_id);
      const targetName =
        vars.grade_id != null
          ? grades.find((g) => g.id === vars.grade_id)?.name ?? 'الصف'
          : sections.find((s) => s.id === vars.section_id)?.name ?? 'الشعبة';
      toast.success(`تم إسناد ${counselor?.full_name ?? 'المرشد'} إلى «${targetName}»`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['counselor-assignments-list'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (vars: { assignment_id: number }) => {
      // Negative ids belong to optimistic-only rows that haven't hit
      // the server yet — silently swallow the call instead of 404'ing.
      if (vars.assignment_id < 0) return vars.assignment_id;
      const r = await fetch(`/api/admin/counselor-assignments/${vars.assignment_id}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `فشل الحذف (${r.status})`);
      }
      return vars.assignment_id;
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['counselor-assignments-list'] });
      const previous = queryClient.getQueryData<Assignment[]>(['counselor-assignments-list']);
      // Capture the row being removed + how many will remain for the
      // same counselor — used in onSuccess to surface the "last scope"
      // warning. Computed from `previous` BEFORE the optimistic write.
      const removed = previous?.find((a) => a.id === vars.assignment_id);
      const remainingCount =
        removed && previous
          ? previous.filter(
              (a) =>
                a.counselor_user_id === removed.counselor_user_id &&
                a.id !== vars.assignment_id,
            ).length
          : 0;
      queryClient.setQueryData<Assignment[]>(['counselor-assignments-list'], (old) =>
        (old ?? []).filter((a) => a.id !== vars.assignment_id),
      );
      return { previous, removed, remainingCount };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['counselor-assignments-list'], context.previous);
      }
      toast.error(err instanceof Error ? err.message : 'فشل الحذف');
    },
    onSuccess: (_data, _vars, context) => {
      // If this was the counselor's last scope, surface a more visible
      // warning. Silent deletion that empties a counselor's reach is a
      // footgun — admins should notice immediately.
      if (context?.removed && context.remainingCount === 0) {
        const counselor = counselors.find((c) => c.user_id === context.removed!.counselor_user_id);
        const name = counselor?.full_name ?? 'المرشد';
        toast(`⚠️ ${name} الآن بلا نطاق — لن يرى أي طالب`, {
          icon: '⚠️',
          duration: 5000,
        });
      } else {
        toast.success('تم حذف الإسناد');
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['counselor-assignments-list'] });
    },
  });

  const handleCellClick = (
    counselor: Counselor,
    grade_id: number | null,
    section_id: number | null,
  ) => {
    const existing = assignmentsMap.get(
      assignmentKey(counselor.user_id, grade_id, section_id),
    );
    if (existing) {
      deleteMutation.mutate({ assignment_id: existing.id });
    } else {
      createMutation.mutate({
        counselor_user_id: counselor.user_id,
        ...(grade_id !== null ? { grade_id } : {}),
        ...(section_id !== null ? { section_id } : {}),
      });
    }
  };

  // --- Render: loading / error / empty / matrix ---
  const isLoading =
    personasQuery.isLoading ||
    assignmentsQuery.isLoading ||
    gradesQuery.isLoading ||
    sectionsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
        جاري التحميل...
      </div>
    );
  }

  if (
    personasQuery.isError ||
    assignmentsQuery.isError ||
    gradesQuery.isError ||
    sectionsQuery.isError
  ) {
    const firstErr =
      personasQuery.error ??
      assignmentsQuery.error ??
      gradesQuery.error ??
      sectionsQuery.error;
    return (
      <div className="card border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
        فشل تحميل البيانات. {firstErr instanceof Error ? firstErr.message : 'حاول تحديث الصفحة.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-amber-500 rounded-xl flex items-center justify-center">
          <ShieldAlert className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">إسنادات المرشدين</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            تحديد نطاق الصفوف والشعب لكل مرشد طلابي
          </p>
        </div>
      </div>

      {/* Warning banner */}
      <div className="card bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              تعديل هذه الصفحة يحتاج صلاحية <code className="font-mono text-xs px-1.5 py-0.5 bg-amber-100 dark:bg-amber-500/20 rounded">manage_users</code>
            </p>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              &quot;كل الصف&quot; يمنح وصولًا لجميع الشعب في الصف. الإسناد الفردي للشعبة يقتصر عليها فقط. الـ schema يسمح بكليهما لنفس المرشد والصف؛ راجع التداخل قبل الحفظ.
            </p>
          </div>
        </div>
      </div>

      {/* Empty state — no counselors */}
      {counselors.length === 0 ? (
        <div className="card text-center py-16">
          <UserPlus className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-700 dark:text-gray-300 font-medium mb-1">
            لا يوجد مرشدون مُعيَّنون بعد
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            عيِّن <code className="font-mono px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">persona=counselor</code> لمستخدم أولًا.
          </p>
          <Link
            href="/dashboard/admin/personas"
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-500/25"
          >
            افتح شاشة الأدوار ←
          </Link>
        </div>
      ) : (
        <>
          {/* Stats line */}
          <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
            <span>👥 المرشدون: <strong>{counselors.length}</strong></span>
            <span>📋 الإسنادات: <strong>{assignments.length}</strong></span>
            {unscopedCounselors.size > 0 && (
              <span className="text-amber-700 dark:text-amber-400">
                ⚠️ بلا نطاق: <strong>{unscopedCounselors.size}</strong>
              </span>
            )}
          </div>

          {/* Matrix */}
          <MatrixTable
            counselors={counselors}
            grades={grades}
            sectionsByGrade={sectionsByGrade}
            assignmentsMap={assignmentsMap}
            unscopedCounselors={unscopedCounselors}
            onCellClick={handleCellClick}
            isPending={createMutation.isPending || deleteMutation.isPending}
          />
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Matrix table
// ===========================================================================
function MatrixTable({
  counselors, grades, sectionsByGrade, assignmentsMap,
  unscopedCounselors, onCellClick, isPending,
}: {
  counselors: Counselor[];
  grades: Grade[];
  sectionsByGrade: Map<number, Section[]>;
  assignmentsMap: Map<string, Assignment>;
  unscopedCounselors: Set<string>;
  onCellClick: (_c: Counselor, _grade_id: number | null, _section_id: number | null) => void;
  isPending: boolean;
}) {
  if (grades.length === 0) {
    return (
      <div className="card text-center py-8 text-sm text-gray-500">
        لا توجد صفوف. أضف الصفوف أولًا من <Link href="/dashboard/grades" className="underline">صفحة الصفوف</Link>.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto p-0">
      <table className="text-xs">
        <thead>
          {/* First header row: grade groups (colspan) */}
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <th className="sticky end-0 bg-white dark:bg-gray-900 z-10 px-3 py-2 text-start font-bold border-s border-gray-200 dark:border-gray-800">
              المرشد
            </th>
            {grades.map((g) => {
              const sections = sectionsByGrade.get(g.id) ?? [];
              const colspan = 1 + sections.length; // 1 for "كل الصف" + each section
              return (
                <th
                  key={g.id}
                  colSpan={colspan}
                  className="px-2 py-1.5 text-center font-bold border-s border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50"
                >
                  {g.name}
                </th>
              );
            })}
          </tr>
          {/* Second header row: "كل الصف" + section names */}
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <th className="sticky end-0 bg-white dark:bg-gray-900 z-10 border-s border-gray-200 dark:border-gray-800"></th>
            {grades.map((g) => {
              const sections = sectionsByGrade.get(g.id) ?? [];
              return (
                <Fragment key={g.id}>
                  {/* The "كل الصف" cell — visually distinguished from
                      sections by background + icon. This is the
                      grade-wide assignment column. */}
                  <th className="px-2 py-1 text-center font-normal bg-indigo-50/60 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-300 border-s border-gray-200 dark:border-gray-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <Globe2 className="w-3 h-3" />
                      كل الصف
                    </span>
                  </th>
                  {sections.map((s) => (
                    <th
                      key={s.id}
                      className="px-2 py-1 text-center font-normal text-gray-700 dark:text-gray-300 whitespace-nowrap"
                    >
                      {s.name}
                    </th>
                  ))}
                </Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {counselors.map((c) => {
            const isUnscoped = unscopedCounselors.has(c.user_id);
            return (
              <tr key={c.user_id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                {/* Counselor name (sticky end column for RTL = right side) */}
                <td className="sticky end-0 bg-white dark:bg-gray-900 z-10 px-3 py-2 border-s border-gray-200 dark:border-gray-800 min-w-[160px]">
                  <p className="font-medium text-sm">
                    {c.full_name || '—'}
                  </p>
                  {c.email && (
                    <p className="text-[10px] text-gray-500 font-mono" dir="ltr">{c.email}</p>
                  )}
                  {isUnscoped && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                      ⚠️ بلا نطاق — لن يرى أي طالب
                    </p>
                  )}
                </td>
                {/* Cells per grade */}
                {grades.map((g) => {
                  const sections = sectionsByGrade.get(g.id) ?? [];
                  return (
                    <Fragment key={g.id}>
                      {/* Grade-wide cell */}
                      <td className="bg-indigo-50/40 dark:bg-indigo-500/5 border-s border-gray-200 dark:border-gray-800">
                        <ToggleCell
                          assigned={assignmentsMap.has(assignmentKey(c.user_id, g.id, null))}
                          gradeWide
                          onClick={() => onCellClick(c, g.id, null)}
                          disabled={isPending}
                        />
                      </td>
                      {/* Section cells */}
                      {sections.map((s) => (
                        <td key={s.id} className="text-center">
                          <ToggleCell
                            assigned={assignmentsMap.has(assignmentKey(c.user_id, null, s.id))}
                            gradeWide={false}
                            onClick={() => onCellClick(c, null, s.id)}
                            disabled={isPending}
                          />
                        </td>
                      ))}
                    </Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Toggle cell
// ===========================================================================
function ToggleCell({
  assigned, gradeWide, onClick, disabled,
}: {
  assigned: boolean;
  gradeWide: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  // Grade-wide assignments get a richer "active" state so admins can
  // see them across a row at a glance. Section assignments are simpler
  // checkmarks — they're the more common case.
  const base =
    'inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const activeCls = assigned
    ? gradeWide
      ? 'bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-500'
      : 'bg-green-600 text-white hover:bg-green-700 dark:bg-green-500'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={assigned ? 'إلغاء الإسناد' : 'إضافة إسناد'}
      className={`${base} ${activeCls}`}
    >
      {assigned && <Check className="w-4 h-4" />}
    </button>
  );
}
