import { z } from 'zod';
import { checkDeviceIp } from '@/lib/utils/ip-allowlist';

// Student schemas
export const createStudentSchema = z.object({
  student_id: z.string().length(10, 'رقم الطالب يجب أن يكون 10 أرقام').regex(/^\d+$/, 'رقم الطالب يجب أن يحتوي على أرقام فقط'),
  first_name: z.string().min(2, 'الاسم الأول مطلوب').max(50),
  last_name: z.string().min(2, 'اسم العائلة مطلوب').max(50),
  father_name: z.string().max(50).optional().default(''),
  email: z.string().email('بريد إلكتروني غير صالح').optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  grade_id: z.number().int().positive('الصف مطلوب'),
  section_id: z.number().int().positive('الشعبة مطلوبة'),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export const updateStudentSchema = createStudentSchema.partial().omit({ student_id: true });

// Device schemas
export const createDeviceSchema = z.object({
  name: z.string().min(1, 'اسم الجهاز مطلوب').max(100),
  ip_address: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'عنوان IP غير صالح').refine(
    (ip) => {
      const parts = ip.split('.').map(Number);
      return parts.every(p => p >= 0 && p <= 255);
    },
    'عنوان IP غير صالح'
  ),
  port: z.number().int().min(1).max(65535).default(4370),
  serial_number: z.string().max(50).optional().or(z.literal('')),
  model: z.string().max(50).default('MB2000'),
  location: z.string().max(200).optional().or(z.literal('')),
  section_id: z.number().int().positive().optional().nullable(),
});

// Allowlist-based IP validation: ZKTeco devices live on internal school
// networks, so blocking RFC1918 outright (the previous behaviour) made device
// registration impossible. checkDeviceIp() permits internal ranges by default,
// blocks loopback/broadcast/link-local/multicast always, and tightens the
// allowlist when ALLOWED_DEVICE_CIDRS or ALLOWED_DEVICE_IP_PREFIXES is set.
export const createDeviceSchemaStrict = createDeviceSchema.superRefine((data, ctx) => {
  const result = checkDeviceIp(data.ip_address);
  if (!result.ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.reason || 'عنوان IP غير مسموح به',
      path: ['ip_address'],
    });
  }
});

// Attendance schemas
export const createAttendanceSchema = z.object({
  student_id: z.number().int().positive(),
  section_id: z.number().int().positive(),
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  punch_time: z.string().optional(),
  status: z.enum(['present', 'late', 'absent', 'excused']),
  minutes_late: z.number().int().min(0).default(0),
  device_id: z.number().int().positive().optional().nullable(),
});

// Settings schemas
export const updateSettingsSchema = z.object({
  school_name: z.string().min(1, 'اسم المدرسة مطلوب').max(200).optional(),
  principal_name: z.string().max(200).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  stage: z.enum(['elementary', 'middle', 'secondary']).optional(),
  academic_year: z.string().max(20).optional(),
  section_type: z.enum(['letters', 'numbers']).optional(),
  late_threshold: z.number().int().min(1).max(120).optional(),
  absent_threshold: z.number().int().min(1).max(240).optional(),
  // HH:MM (24h) — lateness is computed from this time when no per-section schedule exists.
  school_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'وقت غير صالح (HH:MM)')
    .optional(),
});

// Sections schemas
export const updateSectionsSchema = z.object({
  grade_id: z.number().int().positive('الصف مطلوب'),
  sections: z.array(z.object({
    name: z.string().min(1, 'اسم الشعبة مطلوب').max(50),
    sort_order: z.number().int().min(0),
  })).min(1, 'يجب إضافة شعبة واحدة على الأقل'),
});

// Schedule schemas
export const createScheduleSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, 'وقت غير صالح'),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, 'وقت غير صالح'),
});

// Note templates (admin-managed list of predefined notes shown when staff
// records a student note).
export const NOTE_TYPES = ['positive', 'negative'] as const;
export const NOTE_CATEGORIES = ['academic', 'behavior', 'attendance', 'participation', 'general'] as const;
export const NOTE_AUDIENCES = ['admin', 'teacher', 'both'] as const;

export const createNoteTemplateSchema = z.object({
  text: z.string().min(2, 'نص الملاحظة مطلوب').max(300, 'النص طويل جداً'),
  type: z.enum(NOTE_TYPES),
  category: z.enum(NOTE_CATEGORIES).default('general'),
  audience: z.enum(NOTE_AUDIENCES).default('both'),
  // Single emoji or short symbol — keep tight to discourage abuse.
  icon: z.string().max(8).optional().or(z.literal('')),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(9999).default(0),
});

export const updateNoteTemplateSchema = createNoteTemplateSchema.partial();

// Student notes — bulk save endpoint accepts an array. Each entry can either
// reference a template (template_id) or supply free text; validation enforces
// one of the two so we never store an empty note.
export const NOTE_SOURCES = ['template', 'text', 'voice'] as const;

export const studentNoteEntrySchema = z
  .object({
    student_id: z.number().int().positive(),
    template_id: z.number().int().positive().optional().nullable(),
    text: z.string().min(2, 'نص الملاحظة قصير جداً').max(1000),
    type: z.enum(NOTE_TYPES),
    category: z.enum(NOTE_CATEGORIES).optional().nullable(),
    source: z.enum(NOTE_SOURCES).default('text'),
  })
  .refine((v) => v.text.trim().length >= 2, {
    message: 'نص الملاحظة مطلوب',
    path: ['text'],
  });

export const createStudentNotesSchema = z.object({
  notes: z.array(studentNoteEntrySchema).min(1, 'يجب اختيار طالب واحد على الأقل').max(500, 'دفعة واحدة أكبر من اللازم'),
});

// Periods (admin-managed list of class periods)
export const upsertPeriodSchema = z.object({
  number: z.number().int().min(1).max(12),
  name: z.string().min(1, 'اسم الحصة مطلوب').max(50),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'وقت غير صالح').optional().nullable(),
  end_time:   z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'وقت غير صالح').optional().nullable(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
});

// Teacher CRUD
export const createTeacherSchema = z.object({
  email: z.string().email('بريد إلكتروني غير صالح'),
  full_name: z.string().min(2, 'الاسم مطلوب').max(200),
  // Saudi mobile in 9665XXXXXXXX form (12 digits) or local 05XXXXXXXX (10 digits)
  phone: z.string().regex(/^(9665\d{8}|05\d{8})$/, 'رقم الجوال غير صالح'),
});

// Public teacher self-registration (no auth required).
// `website` is a honeypot — invisible to humans, irresistible to bots. Any
// non-empty value means automated submission; we silently drop those.
export const teacherRegistrationSchema = z.object({
  full_name: z.string().min(3, 'الاسم الكامل مطلوب (٣ أحرف على الأقل)').max(200),
  email: z.string().email('بريد إلكتروني غير صالح').max(255),
  phone: z.string().regex(/^(9665\d{8}|05\d{8})$/, 'رقم الجوال غير صالح (مثال: 0555555555)'),
  website: z.string().max(0).optional(),  // honeypot: must be empty
});

export const updateRegistrationSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  notes: z.string().max(500).optional(),
});

export const updateTeacherSchema = z.object({
  full_name: z.string().min(2).max(200).optional(),
  phone: z.string().regex(/^(9665\d{8}|05\d{8})$/, 'رقم الجوال غير صالح').optional(),
  is_active: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'كلمة السر الحالية مطلوبة').max(72),
  new_password: z.string().min(8, 'كلمة السر يجب أن تكون 8 أحرف فأكثر').max(72),
});

// Period attendance — submitted as a session (one save = one record + many absences)
export const PERIOD_ATT_STATUSES = ['absent', 'late', 'excused'] as const;

export const savePeriodAttendanceSchema = z.object({
  section_id: z.number().int().positive(),
  period_id: z.number().int().positive(),
  attendance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  notes: z.string().max(500).optional(),
  // Only non-present students; rest are implicitly present.
  absences: z.array(z.object({
    student_id: z.number().int().positive(),
    status: z.enum(PERIOD_ATT_STATUSES).default('absent'),
    notes: z.string().max(500).optional(),
  })).max(500),
});

// Internal messages — admin/staff ↔ teacher communications
export const MESSAGE_TYPES = ['general', 'student_referral', 'student_notice', 'reply'] as const;
export const MESSAGE_RECIPIENT_ROLES = ['admin', 'teacher', 'staff'] as const;
export const MESSAGE_STATUSES = ['sent', 'read', 'archived', 'closed'] as const;

export const sendMessageSchema = z.object({
  type: z.enum(MESSAGE_TYPES).default('general'),
  recipient_id: z.string().uuid().optional().nullable(),
  recipient_role: z.enum(MESSAGE_RECIPIENT_ROLES).optional().nullable(),
  student_id: z.number().int().positive().optional().nullable(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, 'الرسالة مطلوبة').max(2000),
  parent_message_id: z.number().int().positive().optional().nullable(),
}).refine((v) => v.recipient_id || v.recipient_role, {
  message: 'يجب تحديد المستقبل (مستخدم محدد أو دور)',
});

export const updateMessageStatusSchema = z.object({
  status: z.enum(MESSAGE_STATUSES),
});

// WhatsApp message template editor — admins can change the body and toggle
// active state, but can't rename a template (other code depends on the name).
export const updateMessageTemplateSchema = z.object({
  description: z.string().max(500).optional(),
  body: z.string().min(2, 'النص قصير جداً').max(4000, 'النص طويل جداً'),
  is_active: z.boolean().optional(),
});

// WhatsApp send for notes — accepts either a batch_id (sends all notes from a
// recording session) or an explicit list of note ids.
export const sendNotesWhatsappSchema = z
  .object({
    batch_id: z.string().uuid().optional(),
    note_ids: z.array(z.number().int().positive()).max(500).optional(),
  })
  .refine((v) => !!v.batch_id || (v.note_ids && v.note_ids.length > 0), {
    message: 'يجب تحديد batch_id أو note_ids',
  });

// Import schemas
// Hard ceiling on rows per import — protects the API from accidentally being
// used as a vector for prototype-pollution / ReDoS payloads built upstream
// from xlsx (no upstream patch available for SheetJS).
export const MAX_IMPORT_ROWS = 10_000;

export const importStudentsSchema = z.object({
  students: z.array(z.object({
    student_id: z.string().min(1).max(20),
    first_name: z.string().min(1).max(100),
    last_name: z.string().max(100).optional().default(''),
    father_name: z.string().max(100).optional().default(''),
    phone: z.string().max(20).optional().default(''),
    notes: z.string().max(500).optional().default(''),
    grade_id: z.number().int().positive().optional(),
    section_id: z.number().int().positive().optional(),
    grade_name: z.string().max(100).optional().default(''),
    section_name: z.string().max(100).optional().default(''),
  }))
    .min(1, 'يجب إضافة طالب واحد على الأقل')
    .max(MAX_IMPORT_ROWS, `يتجاوز الحد الأقصى للطلاب في الاستيراد (${MAX_IMPORT_ROWS})`),
  grade_id: z.number().int().positive().optional(),
  section_id: z.number().int().positive().optional(),
  skip_duplicates: z.boolean().default(false),
  auto_create_grades: z.boolean().optional().default(false),
});

// Promote schema
export const promoteSchema = z.object({
  confirm: z.boolean(),
});

// Message template schema
export const updateTemplateSchema = z.object({
  body: z.string().min(5, 'نص الرسالة قصير جداً').max(4000, 'نص الرسالة طويل جداً'),
  description: z.string().max(200).optional().or(z.literal('')),
  is_active: z.boolean().optional(),
});

// Bulk send late notifications
export const sendLateBulkSchema = z.object({
  attendance_ids: z.array(z.number().int().positive()).min(1, 'لا توجد سجلات للإرسال').max(500, 'الحد الأقصى 500 سجل'),
  template_name: z.string().min(1).max(50).default('late_notification'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Bulk delete attendance records
export const deleteAttendanceBulkSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, 'لا يوجد عناصر للحذف').max(500),
});

// Bulk sync from devices
export const syncBulkSchema = z.object({
  device_ids: z.array(z.number().int().positive()).min(1, 'يجب اختيار جهاز واحد على الأقل').max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  // dry_run=true → preview only, no writes. Defaults to true for safety.
  dry_run: z.boolean().optional().default(true),
});

// WhatsApp (WasenderAPI) settings schema
export const updateWhatsappSettingsSchema = z.object({
  // Allow either a fresh key or the masked sentinel meaning "keep existing".
  api_key: z.string().min(10, 'مفتاح API يجب أن يكون 10 أحرف على الأقل').max(500).optional(),
  session_id: z.string().max(100).optional().or(z.literal('')),
});

// Device action schema
export const deviceActionSchema = z.object({
  action: z.enum(['connect', 'disconnect', 'sync-time', 'info', 'users', 'clear-logs', 'push-users', 'pull-logs', 'compare']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Required for destructive actions (clear-logs, push-users, pull-logs).
  confirm: z.boolean().optional(),
});

// Query params helpers
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Helper to safely parse and return typed result or error response
export function validateBody<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstError = result.error.errors[0];
    return { success: false, error: firstError?.message || 'بيانات غير صالحة' };
  }
  return { success: true, data: result.data };
}
