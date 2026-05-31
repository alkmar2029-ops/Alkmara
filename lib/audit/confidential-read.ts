import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/server';

export interface ConfidentialReadEntry {
  tableName: string;
  recordId: string | number;
  studentId?: number | null;
}

export interface ConfidentialReadLogInput {
  accessedBy: string;
  request: Request;
  entries: ConfidentialReadEntry[];
}

export type ConfidentialReadLogResult =
  | { ok: true }
  | { ok: false; res: NextResponse };

function requestIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return request.headers.get('x-real-ip');
}

export async function logConfidentialRead(
  input: ConfidentialReadLogInput,
): Promise<ConfidentialReadLogResult> {
  if (input.entries.length === 0) return { ok: true };

  const ip = requestIp(input.request);
  const userAgent = input.request.headers.get('user-agent');
  const rows = input.entries.map((entry) => ({
    accessed_by: input.accessedBy,
    table_name: entry.tableName,
    record_id: String(entry.recordId),
    student_id: entry.studentId ?? null,
    action: 'read',
    ip_address: ip,
    user_agent: userAgent,
  }));

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('confidential_access_log').insert(rows);
  if (error) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'تعذر تسجيل قراءة البيانات السرية' },
        { status: 500 },
      ),
    };
  }

  return { ok: true };
}
