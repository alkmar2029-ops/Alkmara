import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, writeAuditLog } from '@/lib/supabase/auth';
import {
  createNoteTemplateSchema,
  validateBody,
  NOTE_TYPES,
  NOTE_AUDIENCES,
} from '@/lib/validations/schemas';

export const dynamic = 'force-dynamic';

// GET — list templates. Optional filters:
//   ?type=positive|negative
//   ?audience=admin|teacher|both
//   ?for_role=admin|staff|teacher  → returns audience='both' + matching role
//   ?active=1                       → only active
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get('type');
  const audienceParam = searchParams.get('audience');
  const forRole = searchParams.get('for_role');
  const onlyActive = searchParams.get('active') === '1';

  let query = supabase
    .from('note_templates')
    .select('*')
    .order('type')
    .order('sort_order')
    .order('id');

  if (typeParam && (NOTE_TYPES as readonly string[]).includes(typeParam)) {
    query = query.eq('type', typeParam);
  }
  if (audienceParam && (NOTE_AUDIENCES as readonly string[]).includes(audienceParam)) {
    query = query.eq('audience', audienceParam);
  }
  // Convenience: caller passes the user's role and we resolve to which
  // audiences they can see (always include 'both').
  if (forRole === 'admin' || forRole === 'staff') {
    query = query.in('audience', ['admin', 'both']);
  } else if (forRole === 'teacher') {
    query = query.in('audience', ['teacher', 'both']);
  }
  if (onlyActive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في جلب القوالب' }, { status: 500 });
  }
  return NextResponse.json(
    { data: data || [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

// POST — create a new template. Admin only (RLS would also block staff,
// but reject early so the UI message is in Arabic).
export async function POST(request: NextRequest) {
  const auth = await requireRole(['admin']);
  if (!auth.ok) return auth.res;

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'صيغة البيانات المرسلة غير صالحة' }, { status: 400 });
  }

  const v = validateBody(createNoteTemplateSchema, body);
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('note_templates')
    .insert({
      text: v.data.text.trim(),
      type: v.data.type,
      category: v.data.category,
      audience: v.data.audience,
      icon: v.data.icon || null,
      is_active: v.data.is_active,
      sort_order: v.data.sort_order,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: 'حدث خطأ في إنشاء القالب' }, { status: 500 });
  }

  await writeAuditLog({
    ctx: auth.ctx,
    action: 'note_template.create',
    targetType: 'note_template',
    targetId: data.id,
    details: { type: data.type, category: data.category },
    request,
  });

  return NextResponse.json({ data }, { status: 201 });
}
