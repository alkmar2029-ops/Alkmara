-- WhatsApp message templates for student notes (positive and negative).
-- Editable from the WhatsApp settings page; the recording → print flow sends
-- one of these per note based on its type.

INSERT INTO message_templates (name, description, body, is_active) VALUES
  (
    'note_positive',
    'رسالة واتساب لإبلاغ ولي الأمر بملاحظة إيجابية على الطالب',
    'السلام عليكم ورحمة الله وبركاته 🌟

ولي أمر الطالب/ـة *{{student_name}}*
الصف: {{grade}} — الشعبة: {{section}}

نُسعدنا إعلامكم بالملاحظة الإيجابية التالية على ابنكم:

{{note_emoji}} {{note_text}}

التاريخ: {{date}}
سُجِّلت بواسطة: {{teacher_name}}

نشكركم على تعاونكم 🙏
{{school_name}}',
    true
  ),
  (
    'note_negative',
    'رسالة واتساب لإبلاغ ولي الأمر بملاحظة سلبية على الطالب',
    'السلام عليكم ورحمة الله وبركاته

ولي أمر الطالب/ـة *{{student_name}}*
الصف: {{grade}} — الشعبة: {{section}}

نحيطكم علماً بالملاحظة التالية:

{{note_emoji}} {{note_text}}

التاريخ: {{date}}
سُجِّلت بواسطة: {{teacher_name}}

نأمل التواصل مع المدرسة لمتابعة هذه الملاحظة.
{{school_name}}',
    true
  )
ON CONFLICT (name) DO NOTHING;
