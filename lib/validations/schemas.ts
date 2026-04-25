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
