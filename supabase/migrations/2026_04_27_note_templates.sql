-- Predefined note/observation templates that staff can pick from when
-- recording a student note. Categories let us group them in the UI
-- (e.g., academic / behavior / attendance / participation).

CREATE TABLE IF NOT EXISTS note_templates (
  id          SERIAL PRIMARY KEY,
  text        TEXT NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('positive', 'negative')),
  category    VARCHAR(20) NOT NULL DEFAULT 'general'
              CHECK (category IN ('academic', 'behavior', 'attendance', 'participation', 'general')),
  icon        VARCHAR(8),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS note_templates_type_active_idx
  ON note_templates (type, is_active, sort_order);

ALTER TABLE note_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "note_templates read"      ON note_templates;
DROP POLICY IF EXISTS "note_templates ins admin" ON note_templates;
DROP POLICY IF EXISTS "note_templates upd admin" ON note_templates;
DROP POLICY IF EXISTS "note_templates del admin" ON note_templates;

CREATE POLICY "note_templates read"
  ON note_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "note_templates ins admin"
  ON note_templates FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "note_templates upd admin"
  ON note_templates FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "note_templates del admin"
  ON note_templates FOR DELETE TO authenticated USING (is_admin());

-- Seed a starter set so the page is usable immediately.
INSERT INTO note_templates (text, type, category, icon, sort_order) VALUES
  -- إيجابية
  ('متفوق في إنجاز الواجبات', 'positive', 'academic',      '⭐', 10),
  ('مشاركة فعّالة في الحصة',  'positive', 'participation', '🌟', 20),
  ('التزام تام بالحضور',       'positive', 'attendance',   '🏆', 30),
  ('سلوك مهذّب مع الزملاء',    'positive', 'behavior',     '👍', 40),
  ('تطور ملحوظ في الأداء',     'positive', 'academic',     '📈', 50),
  -- سلبية
  ('عدم إحضار الواجب',         'negative', 'academic',     '📚', 110),
  ('تأخر متكرر عن الحصة',      'negative', 'attendance',   '⏰', 120),
  ('عدم الانتباه أثناء الشرح','negative', 'participation','😐', 130),
  ('إخلال بنظام الفصل',        'negative', 'behavior',     '⚠️', 140),
  ('غياب بدون عذر',            'negative', 'attendance',   '❌', 150)
ON CONFLICT DO NOTHING;
