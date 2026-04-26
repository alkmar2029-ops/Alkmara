import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { validateBody, syncBulkSchema } from '@/lib/validations/schemas';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import { runSync, type SyncEvent } from '@/lib/zkteco/sync-runner';

export const dynamic = 'force-dynamic';
// Allow long-running sync up to 5 minutes (Next.js default is 10s for serverless;
// this is a custom server, so we mainly need to avoid the client aborting).
export const maxDuration = 300;

// Streaming endpoint: emits one JSON object per line (NDJSON) so the client
// can render progress live without polling.
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin', 'staff']);
  if (!auth.ok) return auth.res;

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'صيغة البيانات المرسلة غير صالحة' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const validation = validateBody(syncBulkSchema, body);
  if (!validation.success) {
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { device_ids, date } = validation.data;
  const dry_run: boolean = validation.data.dry_run ?? true;
  const supabase = await createServerSupabaseClient();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (e: SyncEvent) => {
        controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
      };

      let final: SyncEvent | null = null;
      try {
        final = await runSync(supabase, { deviceIds: device_ids, date, dryRun: dry_run, emit });
      } catch (e: any) {
        emit({ type: 'error', message: e?.message || 'فشل غير متوقع أثناء السحب' });
      } finally {
        controller.close();
      }

      // Audit only when actually committing — preview shouldn't pollute the log.
      if (!dry_run) {
        try {
          await writeAuditLog({
            ctx: auth.ctx,
            action: 'devices.sync_bulk',
            targetType: 'devices',
            details: {
              device_ids,
              date,
              written: final?.written ?? 0,
              total_students_late: final?.total_students_late ?? 0,
              errors: final?.errors ?? 0,
            },
            request,
          });
        } catch { /* ignore */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
