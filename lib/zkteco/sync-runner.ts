// Sync runner: pulls attendance from one or more ZKTeco devices, dedups the
// earliest punch per (student_id, attendance_date) across devices, and writes
// each as a 'late' record. No automatic absence — the device is used solely
// to register late arrivals; students who don't punch are considered on time.
//
// Two-phase flow:
//   - dry_run = true  → fetch + dedup + classify against existing DB rows,
//                       return a diff. NOTHING is written.
//   - dry_run = false → same, then upsert the changes.

import { DeviceService, getDeviceFromPool, addDeviceToPool, removeDeviceFromPool } from './device-service';
import type { SupabaseClient } from '@supabase/supabase-js';

export type ChangeKind = 'new' | 'replaces' | 'unchanged' | 'unmatched';

export interface DiffRow {
  kind: ChangeKind;
  student_id: number | null;
  student_code: string | null;
  student_name: string | null;
  grade_name: string | null;
  section_name: string | null;
  device_id: number;
  device_name: string;
  punch_time: string;       // ISO from earliest punch across devices
  punch_local: string;      // HH:MM:SS local
  minutes_late: number;
  // Old DB row, if any:
  old_punch_time?: string | null;
  old_minutes_late?: number | null;
  old_source?: string | null;
}

export interface SyncEvent {
  type:
    | 'started'
    | 'device-start'
    | 'device-time'
    | 'device-progress'
    | 'device-error'
    | 'device-done'
    | 'aggregating'
    | 'comparing'
    | 'preview'
    | 'writing'
    | 'done'
    | 'error';
  device_id?: number;
  device_name?: string;
  message?: string;
  /** School-wide work start time used as the lateness baseline (HH:MM). */
  school_start_time?: string;
  /** Per-device counts. */
  fetched?: number;
  matched?: number;
  /** Device clock check (emitted right after connect, before pulling logs). */
  device_time?: string;       // ISO from device clock
  server_time?: string;       // ISO from server at the same instant
  drift_seconds?: number;     // device − server (negative = device is behind)
  drift_warning?: boolean;    // true when |drift| exceeds threshold
  /** Final summary. */
  total_students_late?: number;
  written?: number;
  errors?: number;
  device_results?: Array<{
    device_id: number;
    name: string;
    ok: boolean;
    fetched: number;
    matched: number;
    error?: string;
    device_time?: string;
    drift_seconds?: number;
  }>;
  /** Diff details (preview / done). */
  dry_run?: boolean;
  diff?: {
    new: DiffRow[];
    replaces: DiffRow[];
    unchanged: DiffRow[];
    unmatched: Array<{ device_id: number; device_name: string; user_id: string; uid: number; punch_time: string; punch_local: string }>;
  };
}

interface DeviceRow {
  id: number;
  name: string;
  ip_address: string;
  port: number;
  section_id: number | null;
}

interface StudentRow {
  id: number;
  student_id: string;
  device_uid: number | null;
  section_id: number | null;
  // joined for display
  first_name?: string | null;
  father_name?: string | null;
  last_name?: string | null;
  grade_name?: string | null;
  section_name?: string | null;
}

interface ScheduleRow {
  id: number;
  class_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/**
 * Match a raw log entry to a student via student_id then device_uid.
 *
 * zkteco-js returns logs with snake_case fields (`user_id`, `record_time`)
 * — older versions used `userId` / `id`. Accept both shapes.
 */
function matchStudent(
  log: { user_id?: string; userId?: string; id?: string; uid?: number | string },
  byStudentId: Map<string, StudentRow>,
  byDeviceUid: Map<number, StudentRow>,
): StudentRow | null {
  const userId = String(log.user_id ?? log.userId ?? log.id ?? '').trim();
  if (userId && byStudentId.has(userId)) return byStudentId.get(userId)!;
  const uid = Number(log.uid ?? 0);
  if (uid && byDeviceUid.has(uid)) return byDeviceUid.get(uid)!;
  return null;
}

/** Pull the punch timestamp from whichever field the lib uses. */
function logTimestamp(log: any): unknown {
  return log?.record_time ?? log?.timestamp ?? log?.recordTime;
}

/** Convert any timestamp (Date | ISO string | epoch ms) to a Date. */
function toDate(t: unknown): Date | null {
  if (!t) return null;
  if (t instanceof Date) return Number.isFinite(t.getTime()) ? t : null;
  const d = new Date(t as any);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Local YYYY-MM-DD in the server's timezone — matches the device's wall clock. */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute minutes late from the section's schedule for the punch's day-of-week.
 * Falls back to the school-wide start time when no per-section schedule exists,
 * so every punch is measured against *something* sensible.
 */
function computeMinutesLate(
  punch: Date,
  schedules: ScheduleRow[],
  fallbackStartTime: string | null,
): number {
  const dow = punch.getDay();
  const matched = schedules.find((s) => s.day_of_week === dow);
  const startStr = matched?.start_time ?? fallbackStartTime ?? null;
  if (!startStr) return 0;
  const [hh, mm] = startStr.split(':').map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  const start = new Date(punch);
  start.setHours(hh, mm, 0, 0);
  const diffMin = Math.floor((punch.getTime() - start.getTime()) / 60000);
  return Math.max(0, diffMin);
}

/** Format a Date as local HH:MM:SS for display. */
function localTimeStr(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export interface RunSyncOpts {
  deviceIds: number[];
  date: string; // YYYY-MM-DD — only logs whose local date matches are kept
  dryRun: boolean;
  emit: (_e: SyncEvent) => void;
}

export async function runSync(supabase: SupabaseClient, opts: RunSyncOpts): Promise<SyncEvent> {
  const { deviceIds, date, emit, dryRun } = opts;

  emit({
    type: 'started',
    message: dryRun
      ? `بدء المعاينة لـ${deviceIds.length} جهاز للتاريخ ${date}`
      : `بدء السحب لـ${deviceIds.length} جهاز للتاريخ ${date}`,
    dry_run: dryRun,
  });

  // School start time is loaded a few lines below; emit a hint event after.

  // 1. Fetch device rows + figure out which sections are involved.
  const { data: deviceRows, error: devErr } = await supabase
    .from('devices')
    .select('id, name, ip_address, port, section_id')
    .in('id', deviceIds);
  if (devErr) {
    const evt: SyncEvent = { type: 'error', message: 'فشل جلب الأجهزة من قاعدة البيانات' };
    emit(evt);
    return evt;
  }
  const devices = (deviceRows || []) as DeviceRow[];
  if (devices.length === 0) {
    const evt: SyncEvent = { type: 'error', message: 'لم يتم العثور على أي جهاز' };
    emit(evt);
    return evt;
  }

  const sectionIds = Array.from(new Set(devices.map((d) => d.section_id).filter((x): x is number => !!x)));

  // 2. Pre-fetch students for the relevant sections (fast lookup).
  // Joined with grade/section names for the diff display.
  let studentsQuery = supabase
    .from('students')
    .select('id, student_id, device_uid, section_id, first_name, father_name, last_name, grades(name), sections(name)')
    .eq('is_active', true);
  if (sectionIds.length > 0) studentsQuery = studentsQuery.in('section_id', sectionIds);
  const { data: studentRows } = await studentsQuery;
  const students: StudentRow[] = (studentRows || []).map((r: any) => ({
    id: r.id,
    student_id: r.student_id,
    device_uid: r.device_uid,
    section_id: r.section_id,
    first_name: r.first_name,
    father_name: r.father_name,
    last_name: r.last_name,
    grade_name: r.grades?.name ?? null,
    section_name: r.sections?.name ?? null,
  }));

  const byStudentId = new Map<string, StudentRow>();
  const byDeviceUid = new Map<number, StudentRow>();
  for (const s of students) {
    if (s.student_id) byStudentId.set(String(s.student_id), s);
    if (s.device_uid) byDeviceUid.set(Number(s.device_uid), s);
  }

  // 3. School-wide fallback start time — used when a section has no schedule row.
  let schoolStartTime: string | null = null;
  try {
    const { data: settingsRow } = await supabase
      .from('school_settings')
      .select('school_start_time')
      .limit(1)
      .maybeSingle();
    schoolStartTime = (settingsRow?.school_start_time as string | undefined) ?? '06:45';
  } catch {
    // Column may not exist on older DBs; fall back to a safe default.
    schoolStartTime = '06:45';
  }
  // Trim seconds if present ('06:45:00' → '06:45') for cleaner UI.
  if (schoolStartTime && /^\d{2}:\d{2}:\d{2}$/.test(schoolStartTime)) {
    schoolStartTime = schoolStartTime.slice(0, 5);
  }
  emit({
    type: 'started',
    message: `وقت الدوام المعتمد: ${schoolStartTime} — يحتسب التأخير من هذا الوقت`,
    school_start_time: schoolStartTime ?? undefined,
    dry_run: dryRun,
  });

  // 3.1. Pre-fetch schedules for involved sections (sections.id == classes.id in K-12).
  let schedules: ScheduleRow[] = [];
  if (sectionIds.length > 0) {
    const { data: schedRows } = await supabase
      .from('class_schedules')
      .select('id, class_id, day_of_week, start_time, end_time')
      .in('class_id', sectionIds);
    schedules = (schedRows || []) as ScheduleRow[];
  }
  const schedulesBySection = new Map<number, ScheduleRow[]>();
  for (const sch of schedules) {
    const arr = schedulesBySection.get(sch.class_id) || [];
    arr.push(sch);
    schedulesBySection.set(sch.class_id, arr);
  }

  // 4. Pull from each device sequentially.
  // Earliest punch per student wins (across all devices).
  const earliest = new Map<number, { punch: Date; device_id: number; section_id: number | null }>();
  const deviceResults: NonNullable<SyncEvent['device_results']> = [];
  const deviceById = new Map<number, DeviceRow>();
  for (const d of devices) deviceById.set(d.id, d);
  const unmatched: NonNullable<SyncEvent['diff']>['unmatched'] = [];

  // |drift| above this threshold raises a warning in the UI; logs may still be pulled.
  const DRIFT_WARN_SECONDS = 120;

  for (const dev of devices) {
    emit({ type: 'device-start', device_id: dev.id, device_name: dev.name });

    let svc = getDeviceFromPool(dev.id);
    let createdNow = false;
    let devTimeIso: string | undefined;
    let driftSec: number | undefined;
    try {
      if (!svc) {
        // Generous timeout — school Wi-Fi can spike to >2s per packet.
        svc = new DeviceService(dev.ip_address, dev.port, 15000);
        createdNow = true;
      }
      if (!svc.isConnected()) {
        await svc.connect();
        if (createdNow) await addDeviceToPool(dev.id, svc);
      }

      // Verify the device's clock before reading logs — if it's drifted, dates
      // on the punches may not match the selected day.
      try {
        const devTime = await svc.getDeviceTime();
        const serverTime = new Date();
        devTimeIso = devTime.toISOString();
        driftSec = Math.round((devTime.getTime() - serverTime.getTime()) / 1000);
        emit({
          type: 'device-time',
          device_id: dev.id,
          device_name: dev.name,
          device_time: devTimeIso,
          server_time: serverTime.toISOString(),
          drift_seconds: driftSec,
          drift_warning: Math.abs(driftSec) > DRIFT_WARN_SECONDS,
          message:
            Math.abs(driftSec) > DRIFT_WARN_SECONDS
              ? `⚠ ساعة الجهاز مختلفة عن الخادم بـ ${driftSec} ثانية — قد تتأثر تواريخ السجلات`
              : `ساعة الجهاز: ${devTime.toLocaleString('ar-SA')} (فرق ${driftSec} ث)`,
        });
      } catch {
        // Non-fatal — clock check is informational; continue with the pull.
        emit({
          type: 'device-time',
          device_id: dev.id,
          device_name: dev.name,
          drift_warning: false,
          message: 'تعذر قراءة ساعة الجهاز (سيتم المتابعة بناءً على تواريخ السجلات نفسها)',
        });
      }

      const logs = await svc.pullAttendanceLogs();
      let matched = 0;
      for (const log of logs as any[]) {
        const punch = toDate(logTimestamp(log));
        if (!punch) continue;
        if (localDateStr(punch) !== date) continue; // filter by selected date
        const stu = matchStudent(log, byStudentId, byDeviceUid);
        if (!stu) {
          unmatched.push({
            device_id: dev.id,
            device_name: dev.name,
            user_id: String(log.user_id ?? log.userId ?? log.id ?? ''),
            uid: Number(log.uid ?? 0),
            punch_time: punch.toISOString(),
            punch_local: localTimeStr(punch),
          });
          continue;
        }

        const prev = earliest.get(stu.id);
        if (!prev || punch.getTime() < prev.punch.getTime()) {
          earliest.set(stu.id, { punch, device_id: dev.id, section_id: stu.section_id });
        }
        matched++;
      }

      deviceResults.push({
        device_id: dev.id, name: dev.name, ok: true, fetched: logs.length, matched,
        device_time: devTimeIso, drift_seconds: driftSec,
      });
      emit({ type: 'device-done', device_id: dev.id, device_name: dev.name, fetched: logs.length, matched });
    } catch (e: any) {
      const msg = e?.message || 'فشل غير متوقع';
      deviceResults.push({
        device_id: dev.id, name: dev.name, ok: false, fetched: 0, matched: 0, error: msg,
        device_time: devTimeIso, drift_seconds: driftSec,
      });
      emit({ type: 'device-error', device_id: dev.id, device_name: dev.name, message: msg });

      // Best-effort cleanup so a stuck connection doesn't block the next device.
      try { if (createdNow) await svc?.disconnect(); } catch { /* ignore */ }
      if (createdNow) removeDeviceFromPool(dev.id);
    }
  }

  // 5. Aggregate.
  emit({ type: 'aggregating', total_students_late: earliest.size });

  // 6. Compare with existing rows for the same date — classify each candidate.
  emit({ type: 'comparing', message: 'مقارنة مع السجلات الموجودة' });

  const stuIds = Array.from(earliest.keys());
  const existingByStudent = new Map<number, { id: number; punch_time: string | null; minutes_late: number | null; source: string | null }>();
  if (stuIds.length > 0) {
    const { data: existingRows } = await supabase
      .from('attendance_records')
      .select('id, student_id, punch_time, minutes_late, source')
      .eq('attendance_date', date)
      .in('student_id', stuIds);
    for (const r of existingRows || []) {
      existingByStudent.set(r.student_id, { id: r.id, punch_time: r.punch_time, minutes_late: r.minutes_late, source: r.source });
    }
  }

  const diff: NonNullable<SyncEvent['diff']> = { new: [], replaces: [], unchanged: [], unmatched };

  // Build the candidate write set, classified.
  const recordsToUpsert: Array<{
    student_id: number;
    device_id: number;
    section_id: number | null;
    attendance_date: string;
    punch_time: string;
    status: 'late';
    minutes_late: number;
    source: 'device';
  }> = [];

  for (const [stuId, e] of earliest) {
    const stu = students.find((s) => s.id === stuId);
    const sectionScheds = e.section_id ? (schedulesBySection.get(e.section_id) || []) : [];
    const minutes_late = computeMinutesLate(e.punch, sectionScheds, schoolStartTime);
    const newPunchIso = e.punch.toISOString();

    const dev = deviceById.get(e.device_id);
    const fullName = stu ? [stu.first_name, stu.father_name, stu.last_name].filter(Boolean).join(' ').trim() : null;

    const baseRow: DiffRow = {
      kind: 'new',
      student_id: stuId,
      student_code: stu?.student_id ?? null,
      student_name: fullName,
      grade_name: stu?.grade_name ?? null,
      section_name: stu?.section_name ?? null,
      device_id: e.device_id,
      device_name: dev?.name ?? '',
      punch_time: newPunchIso,
      punch_local: localTimeStr(e.punch),
      minutes_late,
    };

    const existing = existingByStudent.get(stuId);
    if (!existing) {
      diff.new.push(baseRow);
      recordsToUpsert.push({
        student_id: stuId, device_id: e.device_id, section_id: e.section_id,
        attendance_date: date, punch_time: newPunchIso, status: 'late', minutes_late, source: 'device',
      });
      continue;
    }

    const existingMs = existing.punch_time ? new Date(existing.punch_time).getTime() : Number.POSITIVE_INFINITY;
    const newMs = e.punch.getTime();
    const row: DiffRow = {
      ...baseRow,
      old_punch_time: existing.punch_time,
      old_minutes_late: existing.minutes_late,
      old_source: existing.source,
    };

    if (newMs < existingMs) {
      // Earlier punch arrived → replace.
      row.kind = 'replaces';
      diff.replaces.push(row);
      recordsToUpsert.push({
        student_id: stuId, device_id: e.device_id, section_id: e.section_id,
        attendance_date: date, punch_time: newPunchIso, status: 'late', minutes_late, source: 'device',
      });
    } else {
      row.kind = 'unchanged';
      diff.unchanged.push(row);
      // Do NOT include in upsert list — nothing to write.
    }
  }

  // Always emit the preview event so the UI can render it on dry-run AND commit.
  emit({
    type: 'preview',
    dry_run: dryRun,
    diff,
    total_students_late: earliest.size,
  });

  // 7. Write only when not a dry run.
  let written = 0;
  let writeError: string | null = null;
  if (!dryRun) {
    if (recordsToUpsert.length > 0) {
      emit({ type: 'writing', message: `كتابة ${recordsToUpsert.length} سجل تأخير` });
      const { data, error } = await supabase
        .from('attendance_records')
        .upsert(recordsToUpsert, { onConflict: 'student_id,attendance_date' })
        .select('id');
      if (error) writeError = error.message;
      else written = data?.length ?? recordsToUpsert.length;
    }

    // Persist a sync log per device for traceability (commit only).
    for (const r of deviceResults) {
      await supabase.from('device_sync_logs').insert({
        device_id: r.device_id,
        sync_type: 'pull_attendance_bulk',
        status: r.ok ? 'completed' : 'error',
        records_synced: r.matched,
        error_message: r.error || null,
      });
    }
  }

  const final: SyncEvent = {
    type: writeError ? 'error' : 'done',
    dry_run: dryRun,
    total_students_late: earliest.size,
    written,
    errors: deviceResults.filter((r) => !r.ok).length,
    device_results: deviceResults,
    diff,
    message: writeError
      ? writeError
      : dryRun
      ? `معاينة جاهزة: ${diff.new.length} جديد، ${diff.replaces.length} استبدال، ${diff.unchanged.length} بلا تغيير`
      : `تم تسجيل ${written} سجل تأخير للتاريخ ${date}`,
  };
  emit(final);
  return final;
}
