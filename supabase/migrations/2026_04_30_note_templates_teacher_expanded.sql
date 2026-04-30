-- Expand the note-template library with 30 new teacher-facing entries
-- (15 positive + 15 negative). All audience='teacher' so they appear in
-- the teacher portal but stay out of the admin/parent-facing UI.
--
-- Sort orders are placed in the 1000+ / 2000+ ranges so the new entries
-- appear AFTER the existing seed templates by default; admin can
-- drag-reorder via the dashboard if a different layout is preferred.
--
-- Idempotent: re-running this migration is safe — duplicates by text
-- are filtered out with NOT EXISTS. (No UNIQUE constraint on text, so
-- ON CONFLICT alone wouldn't suffice.)

INSERT INTO note_templates (text, type, category, audience, icon, sort_order)
SELECT v.text, v.type, v.category, v.audience, v.icon, v.sort_order
FROM (VALUES
  -- ───────── إيجابية (15) ─────────
  ('يفسر المفاهيم بطريقة صحيحة',          'positive', 'academic',      'teacher', '💎', 1000),
  ('قراءة بطلاقة وإتقان',                   'positive', 'academic',      'teacher', '📖', 1010),
  ('خط جميل ومرتب',                          'positive', 'academic',      'teacher', '✍️', 1020),
  ('سرعة في الفهم والاستيعاب',              'positive', 'academic',      'teacher', '🧠', 1030),
  ('إبداع في عرض الأفكار',                  'positive', 'participation', 'teacher', '🎨', 1040),
  ('يطرح أسئلة ذكية ومنطقية',               'positive', 'participation', 'teacher', '🔍', 1050),
  ('تفكير نقدي مميز',                        'positive', 'participation', 'teacher', '🤔', 1060),
  ('قائد ممتاز للعمل الجماعي',              'positive', 'behavior',      'teacher', '🤲', 1070),
  ('أخلاق عالية وتعامل راقٍ',                'positive', 'behavior',      'teacher', '🌷', 1080),
  ('يحافظ على نظافة الفصل',                 'positive', 'behavior',      'teacher', '🧹', 1090),
  ('سرعة في تنفيذ المهام الصفية',           'positive', 'participation', 'teacher', '⚡', 1100),
  ('يستذكر الدروس قبل الحصة',               'positive', 'academic',      'teacher', '📚', 1110),
  ('إلقاء ممتاز أمام الزملاء',              'positive', 'participation', 'teacher', '🎤', 1120),
  ('اجتاز الاختبار بتفوق',                  'positive', 'academic',      'teacher', '🌟', 1130),
  ('تركيز عالٍ طوال الحصة',                  'positive', 'participation', 'teacher', '🎯', 1140),

  -- ───────── سلبية (15) ─────────
  ('لم يُنجز النشاط الصفي',                  'negative', 'academic',      'teacher', '📝', 2000),
  ('التحدث دون استئذان',                    'negative', 'behavior',      'teacher', '🗣️', 2010),
  ('نسيان أدوات الحصة',                     'negative', 'academic',      'teacher', '🎒', 2020),
  ('الأكل والشرب في الحصة',                 'negative', 'behavior',      'teacher', '🍪', 2030),
  ('الخروج من الفصل بدون إذن',              'negative', 'behavior',      'teacher', '🚪', 2040),
  ('رفض المشاركة في الأنشطة',               'negative', 'participation', 'teacher', '🤐', 2050),
  ('الكتابة على الطاولات',                  'negative', 'behavior',      'teacher', '✏️', 2060),
  ('ترك المخلفات في الفصل',                 'negative', 'behavior',      'teacher', '🗑️', 2070),
  ('جدال غير مهذب مع المعلم',               'negative', 'behavior',      'teacher', '😤', 2080),
  ('شجار مع أحد الزملاء',                   'negative', 'behavior',      'teacher', '👊', 2090),
  ('تراجع ملحوظ في المستوى',                'negative', 'academic',      'teacher', '📉', 2100),
  ('عدم الصدق مع المعلم',                   'negative', 'behavior',      'teacher', '🤥', 2110),
  ('إضاعة وقت الحصة باللهو',                'negative', 'participation', 'teacher', '🎲', 2120),
  ('تقصير في النظافة الشخصية',              'negative', 'general',       'teacher', '🧴', 2130),
  ('إخلال بقواعد السلامة في المختبر',        'negative', 'behavior',      'teacher', '🧪', 2140)
) AS v(text, type, category, audience, icon, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM note_templates t WHERE t.text = v.text
);
