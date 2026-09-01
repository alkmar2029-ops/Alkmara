'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import InstallPrompt from '@/components/pwa/InstallPrompt';
import GlobalSearch from '@/components/search/GlobalSearch';
import {
  LayoutDashboard, Users, BookOpen, Fingerprint, BarChart3,
  Menu, X, LogOut, ChevronLeft, ChevronDown, Settings, GraduationCap, MessageCircle,
  Sun, Moon, Bell, Download, MessageSquarePlus, UserCog, ClipboardCheck, Mail,
  AlertTriangle, UserPlus, LogOut as ExitIcon, Shield, ShieldAlert, ShieldCheck, KeyRound, Crown,
  CalendarDays, UserCheck, FileText, FileBarChart, GripVertical, Check,
} from 'lucide-react';
import UnreadBadge from '@/components/ui/UnreadBadge';
import PendingRegistrationsBadge from '@/components/ui/PendingRegistrationsBadge';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePersona } from '@/lib/hooks/usePersona';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useQuery } from '@tanstack/react-query';
import type { Persona } from '@/lib/personas/types';

// `superAdminOnly: true` hides the entry for plain admins. The header
// fetches /api/admin-assignments/me to know the current role; the list
// is then filtered before rendering.
// Sidebar organized into thematic groups. Each group has a label that
// renders as a small section header above its items. Empty groups
// (after RBAC filtering) are hidden so non-super_admin users don't see
// orphan headers.
//
// Order is workflow-driven: high-frequency daily operations first,
// supporting features in the middle, infrequent admin tooling last.
interface NavItem {
  path: string;
  label: string;
  icon: any;
  superAdminOnly?: boolean;
  // When set, the item appears only for users with this persona (or
  // super_admin, who can preview every persona's UI). Persona is sourced
  // from usePersona() which already gates on role — viewer/staff with
  // fallback persona='general_admin' will not match here.
  forPersona?: Persona;
  // When set, the item appears only when the user has this permission
  // flag (super_admin always passes). Use this instead of
  // superAdminOnly for entries whose backend API gate is
  // `super_admin OR can(flag)` — keeps the sidebar visibility in sync
  // with the actual access policy (Codex review م1.7d). Typed as string
  // for flexibility across the legacy 10 keys + new 13 persona flags.
  requiresPermission?: string;
}

interface NavGroup {
  label: string | null;  // null = no header (used for the home item)
  items: NavItem[];
}

interface SidebarOrder {
  group_order: string[];
  item_order: Record<string, string[]>;
}

const HOME_GROUP_KEY = '__home__';
const SIDEBAR_COLLAPSED_GROUPS_KEY = 'dashboard-sidebar-collapsed-groups-v1';
const groupKey = (group: NavGroup) => group.label || HOME_GROUP_KEY;

// Fixed school default: daily work first, then role specialties, supporting
// workflows, reports, and finally low-frequency administration/system tools.
const DEFAULT_SIDEBAR_ORDER: SidebarOrder = {
  group_order: [
    HOME_GROUP_KEY,
    'الحضور اليومي',
    'الوكيل',
    'المرشد الطلابي',
    'الطلاب والصفوف',
    'المخالفات',
    'الملاحظات والرسائل',
    'الجدول الذكي',
    'التقارير',
    'تقارير المدرسة',
    'واتساب',
    'المستخدمون',
    'النظام',
    'العمليات اليومية',
  ],
  item_order: {
    'الحضور اليومي': [
      '/dashboard/daily-attendance',
      '/dashboard/period-attendance',
      '/dashboard/dismissals',
      '/dashboard/late-notifications',
    ],
  },
};

function sortByPreferredOrder<T>(values: T[], preferred: string[], key: (_value: T) => string): T[] {
  const ranks = new Map(preferred.map((value, index) => [value, index]));
  return values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (ranks.get(key(a.value)) ?? 10_000 + a.index) - (ranks.get(key(b.value)) ?? 10_000 + b.index))
    .map(({ value }) => value);
}

function applySidebarOrder(groups: NavGroup[], saved: SidebarOrder | null | undefined): NavGroup[] {
  const order = saved || DEFAULT_SIDEBAR_ORDER;
  return sortByPreferredOrder(groups, order.group_order, groupKey).map((group) => ({
    ...group,
    items: sortByPreferredOrder(group.items, order.item_order[groupKey(group)] || [], (item) => item.path),
  }));
}

function serializeSidebarOrder(groups: NavGroup[]): SidebarOrder {
  return {
    group_order: groups.map(groupKey),
    item_order: Object.fromEntries(groups.map((group) => [groupKey(group), group.items.map((item) => item.path)])),
  };
}

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    ],
  },
  {
    label: 'الحضور اليومي',
    items: [
      // /dashboard/attendance (سجل الحضور) is intentionally hidden from
      // the sidebar — it's a legacy view of the attendance_records
      // table populated by the fingerprint device, which this school
      // doesn't currently use. The route + API stay live so the late-
      // notifications, reports, and device-sync pipelines that share
      // attendance_records keep working. Re-add this line when a
      // device gets connected.
      { path: '/dashboard/period-attendance', label: 'حضور الحصص', icon: ClipboardCheck },
      { path: '/dashboard/daily-attendance', label: 'كشف الغياب والهروب', icon: AlertTriangle },
      { path: '/dashboard/dismissals', label: 'استئذان الطلاب', icon: ExitIcon },
      { path: '/dashboard/late-notifications', label: 'إشعارات التأخير', icon: Bell },
    ],
  },
  {
    label: 'الطلاب والصفوف',
    items: [
      { path: '/dashboard/students', label: 'الطلاب', icon: Users },
      { path: '/dashboard/grades', label: 'الصفوف والشعب', icon: BookOpen, superAdminOnly: true },
      { path: '/dashboard/promote', label: 'فتح عام دراسي', icon: GraduationCap, superAdminOnly: true },
    ],
  },
  {
    label: 'الملاحظات والرسائل',
    items: [
      { path: '/dashboard/notes', label: 'الملاحظات', icon: MessageSquarePlus },
      { path: '/dashboard/messages', label: 'الرسائل الداخلية', icon: Mail },
    ],
  },
  {
    // Incidents workflow:
    //   - مخالفاتي (م3.11) — visible to everyone; admins who submit
    //     on behalf see the same "mine" view.
    //   - مراجعة المخالفات (م3.13) — gated by the reviewer flag.
    //     super_admin auto-passes; counselors see the page via their
    //     own sidebar group (COUNSELOR_NAV_GROUPS).
    label: 'المخالفات',
    items: [
      { path: '/dashboard/teacher/incidents', label: 'مخالفاتي', icon: AlertTriangle },
      { path: '/dashboard/vp/incidents/review', label: 'مراجعة المخالفات', icon: ClipboardCheck, requiresPermission: 'review_teacher_incidents' },
    ],
  },
  {
    label: 'الجدول الذكي',
    items: [
      { path: '/dashboard/teacher-schedule', label: 'الجدول الذكي', icon: CalendarDays, superAdminOnly: true },
      // Supervision schedule — visible to everyone (the today view is
      // safe for teachers too); edit pages gate themselves internally.
      { path: '/dashboard/supervision', label: 'إشراف الفسحة', icon: Shield },
    ],
  },
  // Persona-specific groups (placeholder pages live in app/dashboard/vp/
  // and app/dashboard/counselor/). Filtered out for users whose persona
  // doesn't match; super_admin sees both. More items get added per
  // group in their respective sprints (المرحلة 2 for VP, المرحلة 4-5
  // for counselor).
  {
    label: 'الوكيل',
    items: [
      // Flag-based not persona-based: gate parity with the page + API
      // (super_admin OR view_morning_dashboard). A principal /
      // general_admin granted the flag can use these screens, so the
      // sidebar must surface them. forPersona='vice_principal' was
      // narrower than the access policy (Codex م2.13 review).
      { path: '/dashboard/vp/morning', label: 'لوحة الصباح', icon: CalendarDays, requiresPermission: 'view_morning_dashboard' },
      { path: '/dashboard/vp/substitutions', label: 'حصص الانتظار', icon: UserCheck, requiresPermission: 'view_morning_dashboard' },
      { path: '/dashboard/vp/teacher-leaves', label: 'إجازات المعلمين', icon: FileText, requiresPermission: 'view_morning_dashboard' },
      { path: '/dashboard/vp/operations-report', label: 'تقرير العمليات', icon: FileBarChart, requiresPermission: 'view_morning_dashboard' },
    ],
  },
  {
    label: 'المرشد الطلابي',
    items: [
      { path: '/dashboard/counselor/watchlist', label: 'قائمة المتابعة', icon: ShieldAlert, forPersona: 'counselor' },
      { path: '/dashboard/counselor/reports/operational', label: 'تقرير العمليات', icon: FileBarChart, forPersona: 'counselor' },
    ],
  },
  {
    label: 'التقارير',
    items: [
      { path: '/dashboard/reports/builder', label: 'التقارير', icon: BarChart3 },
      { path: '/dashboard/reports/whatsapp', label: 'تقرير الواتساب', icon: MessageCircle, superAdminOnly: true },
    ],
  },
  {
    // Principal-level school aggregates (م6.3). Separate group from
    // VP operations + counselor reports — different audience, different
    // privacy contract (k-anonymity + no drill-down). Gate is the
    // `view_school_reports` flag; super_admin auto-passes.
    label: 'تقارير المدرسة',
    items: [
      { path: '/dashboard/admin/reports/school', label: 'تقرير المدرسة الإجمالي', icon: BarChart3, requiresPermission: 'view_school_reports' },
    ],
  },
  {
    label: 'واتساب',
    items: [
      { path: '/dashboard/whatsapp', label: 'إعدادات WhatsApp', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-bulk-teachers', label: 'تذكير جماعي للمعلمين', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-bulk-parents', label: 'إعلانات جماعية لأولياء الأمور', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-log', label: 'سجل المحادثات', icon: MessageCircle, superAdminOnly: true },
      { path: '/dashboard/whatsapp-issues', label: 'أرقام تحتاج تحديث', icon: AlertTriangle, superAdminOnly: true },
    ],
  },
  {
    label: 'المستخدمون',
    items: [
      // Unified entry — covers both teachers + admins via tabs.
      // /dashboard/teachers stays alive as a legacy route (no sidebar entry).
      { path: '/dashboard/users', label: 'المعلمون والإداريون', icon: UserCog, superAdminOnly: true },
      // Persona/permissions admin — API gate is super_admin OR
      // manage_users (م1.3 + م1.4). Mirror it in the sidebar so an
      // admin with manage_users actually sees the link.
      { path: '/dashboard/admin/personas', label: 'الأدوار والصلاحيات', icon: ShieldCheck, requiresPermission: 'manage_users' },
      // Counselor scope assignments — same API gate (م1.5).
      { path: '/dashboard/admin/counselor-assignments', label: 'إسنادات المرشدين', icon: ShieldAlert, requiresPermission: 'manage_users' },
      { path: '/dashboard/teacher-assignments', label: 'تعيين الشعب للمعلمين', icon: UserCog, superAdminOnly: true },
      { path: '/dashboard/teacher-registrations', label: 'طلبات انضمام المعلمين', icon: UserPlus, superAdminOnly: true },
      { path: '/dashboard/admin-assignments', label: 'تعيين نطاق الإداريين', icon: Shield, superAdminOnly: true },
      { path: '/dashboard/admin-invite-codes', label: 'رموز دعوة الإداريين', icon: KeyRound, superAdminOnly: true },
      { path: '/dashboard/admin-registrations', label: 'طلبات الإداريين', icon: UserPlus, superAdminOnly: true },
    ],
  },
  {
    label: 'النظام',
    items: [
      { path: '/dashboard/devices', label: 'أجهزة البصمة', icon: Fingerprint, superAdminOnly: true },
      { path: '/dashboard/sync', label: 'سحب البيانات', icon: Download, superAdminOnly: true },
      { path: '/dashboard/settings', label: 'إعدادات المدرسة', icon: Settings, superAdminOnly: true },
    ],
  },
];

// Persona-restricted menus. Non-super VP or counselor loads see ONLY
// these entries — NOT a filtered subset of the default navGroups.
// Rationale (Codex review م1.7c): additive filtering left the
// counselor/VP seeing every non-super entry (students, attendance,
// notes, …) because those items aren't marked superAdminOnly. Until
// RLS on every page covered is counselor/VP-aware, a separate menu is
// the safer UX boundary.
//
// More entries get added per upcoming sprints: المرحلة 2 fleshes out
// the VP menu; المرحلة 4-5 fleshes out the counselor menu.
const VP_NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    ],
  },
  {
    label: 'الوكيل',
    items: [
      { path: '/dashboard/vp/morning', label: 'لوحة الصباح', icon: CalendarDays },
      { path: '/dashboard/vp/substitutions', label: 'حصص الانتظار', icon: UserCheck },
      { path: '/dashboard/vp/teacher-leaves', label: 'إجازات المعلمين', icon: FileText },
      { path: '/dashboard/vp/operations-report', label: 'تقرير العمليات', icon: FileBarChart },
      { path: '/dashboard/vp/incidents/review', label: 'مراجعة المخالفات', icon: ClipboardCheck, requiresPermission: 'review_teacher_incidents' },
    ],
  },
  {
    label: 'العمليات اليومية',
    items: [
      // Supervision today view is admin-readable already; VPs (especially
      // student_affairs) own this workflow. Other VP screens are added
      // in المرحلة 2.
      { path: '/dashboard/supervision', label: 'إشراف الفسحة', icon: Shield },
    ],
  },
];

const COUNSELOR_NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { path: '/dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    ],
  },
  {
    label: 'المرشد الطلابي',
    items: [
      { path: '/dashboard/counselor/watchlist', label: 'قائمة المتابعة', icon: ShieldAlert },
      { path: '/dashboard/counselor/reports/operational', label: 'تقرير العمليات', icon: FileBarChart },
      // Counselors see the review queue in read-only mode — buttons
      // gated by the reviewer flag inside the page itself.
      { path: '/dashboard/vp/incidents/review', label: 'مراجعة المخالفات', icon: ClipboardCheck },
    ],
  },
];

interface AdminPolicy {
  is_super_admin: boolean;
  sections: { id: number; name: string; grade_id: number; grade_name: string }[];
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Default closed on small screens; open on desktop. lg: utilities still open on desktop layouts.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [draftNavItems, setDraftNavItems] = useState<NavGroup[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggedNav, setDraggedNav] = useState<
    | { kind: 'group'; group: string }
    | { kind: 'item'; group: string; path: string }
    | null
  >(null);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { theme, toggle, mounted } = useTheme();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_COLLAPSED_GROUPS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
        setCollapsedGroups(new Set(parsed));
      }
    } catch {
      // A corrupt or unavailable local preference must not block navigation.
    }
  }, []);

  // Fetch the current admin's scope. Drives:
  //   • Scope banner under the header for non-super admins.
  //   • Sidebar filtering — superAdminOnly entries hide for plain admins.
  // We use a 5-minute staleTime since assignments change rarely.
  const policyQuery = useQuery<AdminPolicy>({
    queryKey: ['admin-policy-me'],
    queryFn: async () => (await (await fetch('/api/admin-assignments/me')).json()).data,
    staleTime: 5 * 60_000,
  });
  const policy = policyQuery.data;
  // Distinguish "still loading" from "loaded but failed" — the previous
  // `policy === undefined` conflated the two, locking the sidebar to
  // home-only forever if the request 5xx'd (Codex Sprint 1 review).
  const policyFailed = policyQuery.isError;

  // Persona context — drives persona-specific sidebar items (VP /
  // counselor), permission-gated entries via `can`, and the
  // GlobalSearch visibility check. Separate from admin-policy-me
  // (which is about section/grade scope for the scope banner). Both
  // must load before we render the full menu.
  //
  // isSuperAdmin from usePersona is a JWT-derived fallback: if the
  // admin-policy-me query fails, we still want to recognise super_admin
  // (from their role claim) so they don't lose their menu entries.
  const {
    isVicePrincipal,
    isCounselor,
    isLoading: personaLoading,
    isSuperAdmin,
    can,
  } = usePersona();

  const stillLoading = personaLoading || policyQuery.isLoading;
  const isSuper = policyFailed
    ? isSuperAdmin
    : policy?.is_super_admin === true;

  const sidebarOrderQuery = useQuery<SidebarOrder | null>({
    queryKey: ['sidebar-order'],
    queryFn: async () => {
      const response = await fetch('/api/settings/sidebar-order');
      if (!response.ok) throw new Error('تعذر تحميل ترتيب القائمة');
      return (await response.json()).data;
    },
    enabled: !stillLoading,
    staleTime: 5 * 60_000,
  });

  // Distinct grades with section counts for the scope banner.
  const scopeGrades = useMemo(() => {
    if (!policy || policy.is_super_admin) return [];
    const map = new Map<number, { name: string; count: number }>();
    for (const s of policy.sections) {
      const cur = map.get(s.grade_id);
      if (cur) cur.count++;
      else map.set(s.grade_id, { name: s.grade_name, count: 1 });
    }
    return Array.from(map.values());
  }, [policy]);

  // Sidebar visibility — three branches:
  //
  //   1. Loading → home item only. Previously the layout assumed
  //      super_admin during the load window which caused a flash of
  //      sensitive items (Codex م1.7c). Fail-closed.
  //
  //   2. Counselor / VP (non-super) → persona-restricted menu, NOT a
  //      filtered subset of navGroups. Without this branch the user
  //      would still see students/attendance/notes/etc., because most
  //      items aren't marked superAdminOnly. UX scoping only — RLS is
  //      the real access boundary (Codex م1.7c follow-up).
  //
  //   3. Everyone else (principal/general_admin/super_admin/staff/viewer)
  //      → default navGroups with superAdminOnly + forPersona filters.
  //      super_admin picks up the VP/counselor preview entries here.
  //      staff/viewer match neither persona branch (isCounselor /
  //      isVicePrincipal gate on admin role), so they fall through to
  //      this branch — preserving their pre-personas behaviour.
  const baseVisibleNavItems = useMemo(() => {
    if (stillLoading) {
      return [{ label: null, items: navGroups[0].items.slice(0, 1) }];
    }
    // If the policy fetch failed, fall back to the JWT-derived
    // isSuperAdmin so a super_admin still sees their full menu after a
    // transient API hiccup (Codex Sprint 1 review). Plain admins
    // degrade to "not super" — they lose super-only items until the
    // user reloads, but the rest of the menu remains usable.
    const filterGroups = (groups: NavGroup[]) => groups
      .map((g) => ({
        ...g,
        items: g.items.filter((item) => {
          if (item.superAdminOnly && !isSuper) return false;
          if (item.forPersona === 'vice_principal' && !isSuper && !isVicePrincipal) {
            return false;
          }
          if (item.forPersona === 'counselor' && !isSuper && !isCounselor) {
            return false;
          }
          // Permission-gated entry — sidebar visibility tracks the
          // backend's gate exactly (super_admin OR has-flag). Don't
          // hide from a plain admin who legitimately holds the flag.
          if (item.requiresPermission && !isSuper && !can(item.requiresPermission)) {
            return false;
          }
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0);

    if (isCounselor && !isSuper) return filterGroups(COUNSELOR_NAV_GROUPS);
    if (isVicePrincipal && !isSuper) return filterGroups(VP_NAV_GROUPS);

    return filterGroups(navGroups);
  }, [stillLoading, isSuper, isVicePrincipal, isCounselor, can]);

  const visibleNavItems = useMemo(
    () => applySidebarOrder(baseVisibleNavItems, sidebarOrderQuery.data),
    [baseVisibleNavItems, sidebarOrderQuery.data],
  );

  const renderedNavItems = isReordering ? draftNavItems : visibleNavItems;

  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);

      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // Keep the current-session behavior when browser storage is unavailable.
      }

      return next;
    });
  };

  const startReordering = () => {
    setDraftNavItems(visibleNavItems.map((group) => ({ ...group, items: [...group.items] })));
    setIsReordering(true);
  };

  const moveGroup = (targetGroup: string) => {
    if (draggedNav?.kind !== 'group' || draggedNav.group === targetGroup) return;
    setDraftNavItems((current) => {
      const from = current.findIndex((group) => groupKey(group) === draggedNav.group);
      const to = current.findIndex((group) => groupKey(group) === targetGroup);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const moveItem = (targetGroup: string, targetPath: string) => {
    if (draggedNav?.kind !== 'item' || draggedNav.group !== targetGroup || draggedNav.path === targetPath) return;
    setDraftNavItems((current) => current.map((group) => {
      if (groupKey(group) !== targetGroup) return group;
      const from = group.items.findIndex((item) => item.path === draggedNav.path);
      const to = group.items.findIndex((item) => item.path === targetPath);
      if (from < 0 || to < 0) return group;
      const items = [...group.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...group, items };
    }));
  };

  const saveSidebarOrder = async () => {
    setIsSavingOrder(true);
    try {
      const response = await fetch('/api/settings/sidebar-order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeSidebarOrder(draftNavItems)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر حفظ ترتيب القائمة');
      await sidebarOrderQuery.refetch();
      setIsReordering(false);
      toast.success('تم تثبيت ترتيب القائمة لجميع المستخدمين');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ ترتيب القائمة');
    } finally {
      setIsSavingOrder(false);
    }
  };

  // Register the service worker and check for updates periodically. Without
  // this, admins who installed the dashboard PWA never see new versions
  // until they manually clear cache. Same SW used by the teacher portal.
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // 30-min update polling — admins typically keep the dashboard tab
      // open all day so we don't want to force-refresh on every page nav.
      intervalId = setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(() => { /* ignore */ });

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success('تم تسجيل الخروج');
    setLogoutConfirmOpen(false);
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 right-0 z-50 bg-white dark:bg-gray-900 border-s border-gray-200 dark:border-gray-800 transition-all duration-300 flex flex-col
          ${sidebarOpen ? 'w-64' : 'w-20'}
          ${mobileOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        aria-label="الشريط الجانبي"
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          {sidebarOpen && <h1 className="text-lg font-bold text-blue-600 dark:text-blue-400">نظام الحضور</h1>}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:flex p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label={sidebarOpen ? 'طي الشريط' : 'توسيع الشريط'}
          >
            <ChevronLeft className={`w-5 h-5 transition-transform ${!sidebarOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-2 text-gray-600 dark:text-gray-300"
            aria-label="إغلاق القائمة"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="القائمة الرئيسية" className="flex-1 py-4 px-3 overflow-y-auto">
          {isSuper && sidebarOpen && (
            <div className="mb-3 pb-3 border-b border-gray-200 dark:border-gray-800">
              {!isReordering ? (
                <button
                  type="button"
                  onClick={startReordering}
                  className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600"
                >
                  <GripVertical className="w-4 h-4" />
                  ترتيب القائمة بالسحب
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-blue-700 dark:text-blue-300 text-center">
                    اسحب الأقسام أو العناصر، ثم احفظ الترتيب الثابت للجميع
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsReordering(false)}
                      disabled={isSavingOrder}
                      className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-xs"
                    >
                      إلغاء
                    </button>
                    <button
                      type="button"
                      onClick={saveSidebarOrder}
                      disabled={isSavingOrder}
                      className="flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 text-white text-xs disabled:opacity-60"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {isSavingOrder ? 'جارٍ الحفظ...' : 'حفظ'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {renderedNavItems.map((group, gi) => {
            const key = groupKey(group);
            const isDraggedGroup = draggedNav?.kind === 'group' && draggedNav.group === key;
            // The compact icon rail and reorder mode always expose every item.
            const isCollapsed = sidebarOpen
              && !isReordering
              && collapsedGroups.has(key);
            return (
            <div
              key={key}
              draggable={isReordering && sidebarOpen}
              onDragStart={(event) => {
                if (!isReordering) return;
                setDraggedNav({ kind: 'group', group: key });
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (draggedNav?.kind === 'group') event.preventDefault();
              }}
              onDrop={(event) => {
                if (draggedNav?.kind !== 'group') return;
                event.preventDefault();
                moveGroup(key);
                setDraggedNav(null);
              }}
              onDragEnd={() => setDraggedNav(null)}
              className={`${gi > 0 ? (sidebarOpen ? 'mt-4' : 'mt-3 pt-3 border-t border-gray-200 dark:border-gray-800') : ''} ${isDraggedGroup ? 'opacity-40' : ''}`}
            >
              {sidebarOpen && group.label && (
                <button
                  type="button"
                  onClick={() => {
                    if (!isReordering) toggleGroupCollapsed(key);
                  }}
                  aria-expanded={!isCollapsed}
                  aria-controls={`sidebar-group-${gi}`}
                  className={`w-full px-3 mb-1 py-1 flex items-center gap-1 rounded-md text-xs font-bold text-gray-500 dark:text-gray-400 ${
                    isReordering
                      ? 'cursor-grab'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {isReordering && <GripVertical className="w-3.5 h-3.5 cursor-grab" aria-hidden="true" />}
                  <span className="truncate">{group.label}</span>
                  {!isReordering && (
                    <ChevronDown
                      className={`w-4 h-4 ms-auto shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              )}
              <div
                id={`sidebar-group-${gi}`}
                aria-hidden={isCollapsed}
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  isCollapsed
                    ? 'grid-rows-[0fr] opacity-0 invisible pointer-events-none'
                    : 'grid-rows-[1fr] opacity-100 visible'
                }`}
              >
                <div className="overflow-hidden space-y-1">
                  {group.items.map((item) => {
                    const isActive = pathname === item.path
                      || (item.path !== '/dashboard' && pathname.startsWith(item.path));
                    const Icon = item.icon;
                    return (
                      <Link
                      key={item.path}
                      href={item.path}
                      draggable={isReordering && sidebarOpen}
                      onDragStart={(event) => {
                        if (!isReordering) return;
                        event.stopPropagation();
                        setDraggedNav({ kind: 'item', group: key, path: item.path });
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => {
                        if (draggedNav?.kind === 'item' && draggedNav.group === key) {
                          event.preventDefault();
                          event.stopPropagation();
                        }
                      }}
                      onDrop={(event) => {
                        if (draggedNav?.kind !== 'item') return;
                        event.preventDefault();
                        event.stopPropagation();
                        moveItem(key, item.path);
                        setDraggedNav(null);
                      }}
                      onDragEnd={(event) => {
                        event.stopPropagation();
                        setDraggedNav(null);
                      }}
                      onClick={(event) => {
                        if (isReordering) {
                          event.preventDefault();
                          return;
                        }
                        setMobileOpen(false);
                      }}
                      title={!sidebarOpen ? item.label : undefined}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-500/15 dark:text-blue-300'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      } ${!sidebarOpen ? 'justify-center' : ''} ${isReordering ? 'cursor-grab ring-1 ring-transparent hover:ring-blue-300' : ''}`}
                    >
                      {isReordering && sidebarOpen && <GripVertical className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                      <Icon className="w-5 h-5 flex-shrink-0" />
                      {sidebarOpen && <span className="truncate flex-1">{item.label}</span>}
                      {item.path === '/dashboard/messages' && <UnreadBadge />}
                      {item.path === '/dashboard/teacher-registrations' && <PendingRegistrationsBadge />}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          );
          })}
        </nav>

        <div className="border-t border-gray-200 dark:border-gray-800 p-3 space-y-1 shrink-0">
          <button
            onClick={toggle}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800 ${!sidebarOpen ? 'justify-center' : ''}`}
            aria-label={theme === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن'}
            title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {mounted && (theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />)}
            {sidebarOpen && <span>{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>}
          </button>
          <button
            onClick={() => setLogoutConfirmOpen(true)}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-gray-600 hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-500/10 dark:hover:text-red-400 ${!sidebarOpen ? 'justify-center' : ''}`}
          >
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>تسجيل خروج</span>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen min-w-0">
        <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 lg:px-6 sticky top-0 z-30 gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label="فتح القائمة"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Global search (Cmd+K). Hidden for counselors — the search
              currently spans school-wide students/notes, but a counselor
              should only see within counselor_assignments. Re-enable
              once the search API enforces scope. Also hidden while
              persona/policy load, to avoid a flash for counselors. */}
          {!stillLoading && !isCounselor && <GlobalSearch />}

          {/* Mobile theme toggle in header (sidebar is hidden) */}
          <button
            onClick={toggle}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
            aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
          >
            {mounted && (theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />)}
          </button>
        </header>

        {/* Policy load failure — surface so the admin knows the scope
            data didn't fetch and some sidebar items may be hidden.
            Without this banner, a 5xx on /api/admin-assignments/me
            silently degraded the menu (Codex Sprint 1 review). */}
        {policyFailed && (
          <div className="bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 px-4 py-1.5">
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
              <span className="text-amber-900 dark:text-amber-200">
                تعذّر تحميل صلاحياتك بالكامل. بعض القوائم قد تكون مخفية. حاول تحديث الصفحة.
              </span>
            </div>
          </div>
        )}

        {/* Scope banner — super_admin: gold "Crown" badge; plain admin:
            blue scope summary; both let the user know their privilege level
            at a glance. Hidden until policy loads to avoid layout flicker. */}
        {policy && (
          policy.is_super_admin ? (
            <div className="bg-gradient-to-l from-yellow-100 to-amber-50 dark:from-yellow-500/10 dark:to-amber-500/5 border-b border-yellow-200 dark:border-yellow-500/30 px-4 py-1.5">
              <div className="flex items-center gap-2 text-xs">
                <Crown className="w-3.5 h-3.5 text-yellow-700 dark:text-yellow-400" />
                <span className="font-semibold text-yellow-900 dark:text-yellow-200">المدير العام (Super Admin)</span>
                <span className="text-yellow-700 dark:text-yellow-400">— ترى كل بيانات المدرسة</span>
              </div>
            </div>
          ) : (
            <div className="bg-purple-50 dark:bg-purple-500/10 border-b border-purple-200 dark:border-purple-500/30 px-4 py-1.5">
              <div className="flex items-center gap-2 text-xs flex-wrap">
                <Shield className="w-3.5 h-3.5 text-purple-700 dark:text-purple-400" />
                <span className="font-semibold text-purple-900 dark:text-purple-200">إداري</span>
                {scopeGrades.length === 0 ? (
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    ⚠️ لم يتم تعيينك على شعب — تواصل مع المدير
                  </span>
                ) : (
                  <span className="text-purple-700 dark:text-purple-300">
                    تُشرف على: {scopeGrades.map((g) => `${g.name} (${g.count})`).join(' • ')}
                  </span>
                )}
              </div>
            </div>
          )
        )}

        <main id="main" tabIndex={-1} className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>

      {/* PWA install banner — Chrome/Edge fires beforeinstallprompt;
          iOS Safari shows a "tap Share → Add to Home Screen" hint instead.
          Auto-hides when the app is already running standalone. */}
      <InstallPrompt />
      <ConfirmDialog
        isOpen={logoutConfirmOpen}
        title="تسجيل الخروج"
        message="هل تريد تسجيل الخروج من لوحة التحكم؟"
        confirmText="تسجيل الخروج"
        cancelText="إلغاء"
        variant="warning"
        onConfirm={handleLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
}
