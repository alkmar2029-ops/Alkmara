'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Shield, Calendar, Printer, Send, Loader2, CheckCircle2, XCircle,
  Pencil, MapPin, Phone, Settings, ArrowLeftRight,
} from 'lucide-react';

interface TodayAssignment {
  location_id: number;
  location_name: string | null;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  notes: string | null;
}

interface TodayResponse {
  date: string;
  day_of_week: number;
  day_name: string;
  weekend?: boolean;
  assignments: TodayAssignment[];
  reminder_log: { sent_at: string; sent_count: number; failed_count: number } | null;
}

interface MyContext { is_super_admin: boolean; role?: string }
interface MyProfile { permissions?: Record<string, boolean> }

export default function SupervisionTodayPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<TodayResponse>({
    queryKey: ['supervision-today'],
    queryFn: async () => (await (await fetch('/api/supervision/today')).json()).data,
    refetchInterval: 60_000,   // pick up reminder-log changes
  });

  // Role + permissions for the management buttons. /api/admin-assignments/me
  // already returns role + is_super_admin; we look up permissions from the
  // existing /api/teachers won't work — use /api/admins/me-style instead.
  // Keep it simple: look up via /api/admin-assignments/me (gives role) then
  // separately fetch this user's perms via a small endpoint we already have
  // in /api/admins (lists includes self). For MVP, we fall back to letting
  // the API return 403 if not allowed and just show all buttons.
  const { data: meCtx } = useQuery<MyContext>({
    queryKey: ['me-supervision'],
    queryFn: async () => {
      const r = await fetch('/api/admin-assignments/me');
      if (!r.ok) return { is_super_admin: false };
      return (await r.json()).data || { is_super_admin: false };
    },
    staleTime: 5 * 60 * 1000,
  });
  const canEdit = meCtx?.is_super_admin || meCtx?.role === 'super_admin' || meCtx?.role === 'admin';

  const reminderMut = useMutation({
    mutationFn: async (force: boolean) => {
      const r = await fetch('/api/supervision/reminder/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'فشل');
      return d.data as { triggered: boolean; reason?: string; sent_count?: number; failed_count?: number };
    },
    onSuccess: (d) => {
      if (!d.triggered) {
        toast(d.reason === 'already_sent_today' ? 'تم الإرسال اليوم — اضغط "إعادة الإرسال" للتجاوز' : `لم يُرسَل: ${d.reason}`, { icon: 'ℹ️' });
      } else if (d.sent_count) {
        toast.success(`📤 أُرسل ${d.sent_count} رسالة` + (d.failed_count ? ` • فشل ${d.failed_count}` : ''));
      } else {
        toast('لا يوجد مشرفون اليوم', { icon: 'ℹ️' });
      }
      qc.invalidateQueries({ queryKey: ['supervision-today'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin inline text-gray-400" /></div>;
  }

  const isWeekend = data?.weekend;
  const items = data?.assignments || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">إشراف الفسحة</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {isWeekend
                ? <span>عطلة نهاية الأسبوع — لا يوجد إشراف</span>
                : <span>اليوم: <strong>{data?.day_name}</strong> • {data?.date}</span>
              }
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/supervision/swaps" className="btn-secondary inline-flex items-center gap-1">
            <ArrowLeftRight className="w-4 h-4" /> طلبات التبديل
          </Link>
          {canEdit && (
            <>
              <Link href="/dashboard/supervision/locations" className="btn-secondary inline-flex items-center gap-1">
                <MapPin className="w-4 h-4" /> المواقع
              </Link>
              <Link href="/dashboard/supervision/schedule" className="btn-secondary inline-flex items-center gap-1">
                <Pencil className="w-4 h-4" /> جدول الأسبوع
              </Link>
            </>
          )}
          <Link
            href={`/dashboard/supervision/print?date=${data?.date || ''}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary inline-flex items-center gap-1"
          >
            <Printer className="w-4 h-4" /> طباعة النموذج
          </Link>
        </div>
      </div>

      {/* Reminder status */}
      {!isWeekend && (
        <div className="card flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {data?.reminder_log ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold">تم إرسال تذكير الواتساب اليوم</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    📤 {data.reminder_log.sent_count} مُرسَل
                    {data.reminder_log.failed_count > 0 && <> • ❌ {data.reminder_log.failed_count} فشل</>}
                    {' '}في {new Date(data.reminder_log.sent_at).toLocaleTimeString('ar-SA-u-ca-gregory', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold">لم يُرسَل تذكير الواتساب بعد اليوم</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    يُرسَل تلقائياً صباحاً عند فتح أول أدمن للوحة، أو يدوياً من الزر
                  </p>
                </div>
              </>
            )}
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button
                onClick={() => reminderMut.mutate(false)}
                disabled={reminderMut.isPending}
                className="btn-secondary text-sm inline-flex items-center gap-1"
              >
                {reminderMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                إرسال الآن
              </button>
              {data?.reminder_log && (
                <button
                  onClick={() => { if (confirm('إعادة إرسال التذكير لجميع المشرفين؟')) reminderMut.mutate(true); }}
                  disabled={reminderMut.isPending}
                  className="btn-secondary text-sm inline-flex items-center gap-1 border-amber-300 text-amber-700 dark:text-amber-400"
                >
                  🔁 إعادة الإرسال
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Today's roster */}
      {isWeekend ? (
        <div className="card text-center py-12 text-gray-500 dark:text-gray-400">
          🕌 يوم عطلة — لا إشراف فسحة
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-12">
          <Shield className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-700 mb-2" />
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-3">لا توجد تعيينات لهذا اليوم بعد</p>
          {canEdit && (
            <Link href="/dashboard/supervision/schedule" className="btn-primary inline-flex items-center gap-1 text-sm">
              <Settings className="w-4 h-4" /> اذهب لإعداد جدول الأسبوع
            </Link>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium w-8">#</th>
                  <th className="px-3 py-2 font-medium">المعلم / الإداري</th>
                  <th className="px-3 py-2 font-medium">موقع الإشراف</th>
                  <th className="px-3 py-2 font-medium">الجوال</th>
                  <th className="px-3 py-2 font-medium">ملاحظة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {items.map((a, i) => (
                  <tr key={a.location_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 font-medium">{a.full_name || <span className="text-gray-400">— غير معروف —</span>}</td>
                    <td className="px-3 py-2">📍 {a.location_name || '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {a.phone ? (
                        <a href={`https://wa.me/${a.phone.replace(/[^\d]/g, '')}`} target="_blank" rel="noopener noreferrer" className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {a.phone}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{a.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
