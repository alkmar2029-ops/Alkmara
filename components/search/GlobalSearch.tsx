'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Search, X, Users, BookOpen, GraduationCap, Loader2, Clock, ArrowLeft,
  Phone, Hash, AlertCircle, MessageCircle,
} from 'lucide-react';

interface StudentResult {
  id: number;
  student_id: string;
  name: string;
  phone: string | null;
  section_id: number;
  section_name: string | null;
  grade_name: string | null;
}

interface TeacherResult {
  user_id: string;
  full_name: string;
  phone: string | null;
}

interface SectionResult {
  id: number;
  name: string;
  grade_name: string;
}

interface SearchResponse {
  query: string;
  intent: {
    type: 'plain' | 'student_id' | 'phone' | 'section' | 'context';
    value?: string;
    keyword?: string;
    rest?: string;
    grade?: string;
    section?: string;
  };
  results: {
    students: StudentResult[];
    teachers: TeacherResult[];
    sections: SectionResult[];
  };
}

const RECENT_KEY = 'global_search_recent_v1';
const MAX_RECENT = 5;

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}
function saveRecent(q: string) {
  if (!q.trim()) return;
  const list = [q, ...loadRecent().filter((x) => x !== q)].slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

/**
 * Cmd+K-style global search modal. Opens via:
 *   • Ctrl/Cmd+K from any page
 *   • The search button in the topbar
 *   • Programmatic call (export setOpen)
 *
 * Searches students, teachers, and sections in parallel via /api/search.
 * Supports intent recognition — typing "1/3" navigates to that section
 * directly when Enter is pressed; "غياب احمد" filters absences-today.
 *
 * Keyboard:
 *   ↑↓   navigate results
 *   ↵    open the focused row
 *   Esc  close
 */
export default function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);

  // Mount keyboard shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Debounce typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Load recent on mount.
  useEffect(() => { setRecent(loadRecent()); }, []);

  // Auto-focus input on open + reset state.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setFocusIdx(0);
    } else {
      setQuery('');
      setDebounced('');
    }
  }, [open]);

  const { data, isFetching } = useQuery<SearchResponse>({
    queryKey: ['global-search', debounced],
    queryFn: async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`);
      if (!r.ok) throw new Error('failed');
      return (await r.json()).data;
    },
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  });

  // Flatten results for keyboard navigation.
  const flatRows = useMemo(() => {
    if (!data) return [] as Array<{ kind: 'student' | 'teacher' | 'section' | 'action'; href: string; row: any }>;
    const rows: Array<{ kind: 'student' | 'teacher' | 'section' | 'action'; href: string; row: any }> = [];
    // Intent-based actions first (smart navigation).
    if (data.intent?.type === 'context') {
      const map: Record<string, string> = {
        absence: '/dashboard/daily-attendance',
        escape: '/dashboard/daily-attendance',
        late: '/dashboard/late-notifications',
        dismissal: '/dashboard/dismissals',
      };
      const href = map[data.intent.keyword as string];
      if (href) rows.push({ kind: 'action', href, row: { keyword: data.intent.keyword, rest: data.intent.rest } });
    }
    if (data.intent?.type === 'section' && data.results.sections.length > 0) {
      const s = data.results.sections[0];
      rows.push({ kind: 'section', href: `/dashboard/period-attendance?section_id=${s.id}`, row: s });
    }
    for (const s of data.results.students || []) {
      rows.push({ kind: 'student', href: `/dashboard/students/${s.id}`, row: s });
    }
    for (const t of data.results.teachers || []) {
      rows.push({ kind: 'teacher', href: `/dashboard/teachers`, row: t });
    }
    for (const s of data.results.sections || []) {
      // skip if already added via intent
      if (rows.some((r) => r.kind === 'section' && r.row.id === s.id)) continue;
      rows.push({ kind: 'section', href: `/dashboard/period-attendance?section_id=${s.id}`, row: s });
    }
    return rows;
  }, [data]);

  // Reset focus when results change.
  useEffect(() => { setFocusIdx(0); }, [flatRows.length]);

  // Keyboard nav for results.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(flatRows.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const target = flatRows[focusIdx];
        if (target) {
          saveRecent(query);
          setOpen(false);
          router.push(target.href);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, flatRows, focusIdx, query, router]);

  if (!open) {
    // Render the trigger button + invisible mount point.
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 min-w-[200px]"
        aria-label="بحث عالمي"
      >
        <Search className="w-4 h-4" />
        <span className="flex-1 text-start">بحث...</span>
        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">Ctrl K</kbd>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-start justify-center p-4 pt-20"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 p-3 border-b border-gray-200 dark:border-gray-800">
          <Search className="w-5 h-5 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن طالب، معلم، شعبة... جرّب: 'غياب احمد' أو '1/3'"
            className="flex-1 outline-none bg-transparent text-base"
            autoComplete="off"
          />
          {isFetching && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!debounced.trim() ? (
            <RecentList recent={recent} onSelect={(q) => setQuery(q)} />
          ) : flatRows.length === 0 && !isFetching ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">
              لا توجد نتائج للبحث "{query}"
            </p>
          ) : (
            <div className="py-2">
              {/* Intent action banner */}
              {data?.intent?.type === 'context' && (
                <div className="mx-2 mb-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-xs text-blue-800 dark:text-blue-300">
                  💡 الذهاب إلى صفحة {keywordLabel(data.intent.keyword as string)}
                </div>
              )}
              {data?.intent?.type === 'section' && (
                <div className="mx-2 mb-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-xs text-purple-800 dark:text-purple-300">
                  💡 الذهاب إلى الشعبة {data.intent.grade}/{data.intent.section}
                </div>
              )}

              {flatRows.map((r, i) => (
                <ResultRow
                  key={`${r.kind}-${r.row.id || r.row.user_id || i}`}
                  row={r}
                  focused={i === focusIdx}
                  onClick={() => {
                    saveRecent(query);
                    setOpen(false);
                    router.push(r.href);
                  }}
                  onMouseEnter={() => setFocusIdx(i)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2 text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-3">
          <span><kbd className="px-1 rounded bg-gray-100 dark:bg-gray-700">↑↓</kbd> تنقّل</span>
          <span><kbd className="px-1 rounded bg-gray-100 dark:bg-gray-700">↵</kbd> فتح</span>
          <span><kbd className="px-1 rounded bg-gray-100 dark:bg-gray-700">Esc</kbd> إغلاق</span>
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  row, focused, onClick, onMouseEnter,
}: {
  row: { kind: string; href: string; row: any };
  focused: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  const cls = `flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
    focused ? 'bg-blue-50 dark:bg-blue-500/15' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'
  }`;

  if (row.kind === 'action') {
    return (
      <div onClick={onClick} onMouseEnter={onMouseEnter} className={cls}>
        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-4 h-4 text-blue-700 dark:text-blue-400 rotate-180" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">اذهب إلى صفحة {keywordLabel(row.row.keyword)}</p>
          {row.row.rest && <p className="text-xs text-gray-500">للبحث عن: "{row.row.rest}"</p>}
        </div>
      </div>
    );
  }

  if (row.kind === 'student') {
    const s = row.row as StudentResult;
    return (
      <div onClick={onClick} onMouseEnter={onMouseEnter} className={cls}>
        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
          <Users className="w-4 h-4 text-blue-700 dark:text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{s.name}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-2">
            {s.grade_name && <span>{s.grade_name}/{s.section_name}</span>}
            <span className="font-mono" dir="ltr">#{s.student_id}</span>
            {s.phone && <span className="font-mono" dir="ltr">{s.phone}</span>}
          </p>
        </div>
      </div>
    );
  }

  if (row.kind === 'teacher') {
    const t = row.row as TeacherResult;
    return (
      <div onClick={onClick} onMouseEnter={onMouseEnter} className={cls}>
        <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center shrink-0">
          <GraduationCap className="w-4 h-4 text-purple-700 dark:text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">أ. {t.full_name}</p>
          {t.phone && (
            <p className="text-[11px] text-gray-500 font-mono" dir="ltr">{t.phone}</p>
          )}
        </div>
      </div>
    );
  }

  if (row.kind === 'section') {
    const s = row.row as SectionResult;
    return (
      <div onClick={onClick} onMouseEnter={onMouseEnter} className={cls}>
        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{s.grade_name} / {s.name}</p>
          <p className="text-[11px] text-gray-500">شعبة دراسية</p>
        </div>
      </div>
    );
  }
  return null;
}

function RecentList({ recent, onSelect }: { recent: string[]; onSelect: (q: string) => void }) {
  return (
    <div className="py-3 px-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-2">
        بحثات سابقة
      </p>
      {recent.length === 0 ? (
        <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          ابدأ بكتابة اسم طالب، أو رقم هويته، أو "1/3" للذهاب لشعبة
        </div>
      ) : (
        <ul className="space-y-0.5">
          {recent.map((q) => (
            <li key={q}>
              <button
                onClick={() => onSelect(q)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60 text-start"
              >
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                <span>{q}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-800 px-2">
        <p className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
          أوامر ذكية
        </p>
        <ul className="text-xs space-y-1.5 text-gray-600 dark:text-gray-300">
          <li className="flex items-center gap-2"><Hash className="w-3 h-3" /> رقم هوية ١٠ خانات → ملف الطالب</li>
          <li className="flex items-center gap-2"><Phone className="w-3 h-3" /> 05xxxxxxxx → بحث برقم الجوال</li>
          <li className="flex items-center gap-2"><BookOpen className="w-3 h-3" /> "1/3" → فتح الشعبة مباشرة</li>
          <li className="flex items-center gap-2"><AlertCircle className="w-3 h-3" /> "غياب احمد" → غياب طلاب اسمهم احمد</li>
          <li className="flex items-center gap-2"><MessageCircle className="w-3 h-3" /> "استئذان فهد" → استئذانات اليوم</li>
        </ul>
      </div>
    </div>
  );
}

function keywordLabel(k: string): string {
  return {
    absence: 'كشف الغياب',
    escape: 'كشف الهروب',
    late: 'إشعارات التأخير',
    dismissal: 'استئذان الطلاب',
  }[k] || k;
}
