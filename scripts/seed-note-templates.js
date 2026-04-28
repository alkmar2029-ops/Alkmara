// Seed expanded note templates with audiences.
// Run once: node scripts/seed-note-templates.js
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const sb = createClient(url, key);

const TEMPLATES = [
  // ===== POSITIVE — both =====
  { text: 'متفوق في إنجاز الواجبات', type: 'positive', category: 'academic',      audience: 'both',    icon: '⭐', sort_order: 10 },
  { text: 'مشاركة فعّالة في الحصة',  type: 'positive', category: 'participation', audience: 'both',    icon: '🌟', sort_order: 20 },
  { text: 'التزام تام بالحضور',       type: 'positive', category: 'attendance',   audience: 'both',    icon: '🏆', sort_order: 30 },
  { text: 'سلوك مهذّب مع الزملاء',    type: 'positive', category: 'behavior',     audience: 'both',    icon: '👍', sort_order: 40 },
  { text: 'تطور ملحوظ في الأداء',     type: 'positive', category: 'academic',     audience: 'both',    icon: '📈', sort_order: 50 },
  // POSITIVE — teacher
  { text: 'إجابات ممتازة على أسئلة الحصة', type: 'positive', category: 'participation', audience: 'teacher', icon: '🎯', sort_order: 60 },
  { text: 'مساعدة زملائه في الفهم',         type: 'positive', category: 'behavior',     audience: 'teacher', icon: '🤝', sort_order: 70 },
  { text: 'ملف الواجبات منظّم ومرتب',       type: 'positive', category: 'academic',     audience: 'teacher', icon: '📝', sort_order: 80 },
  // POSITIVE — admin
  { text: 'متميز في النشاطات اللاصفية',     type: 'positive', category: 'general',      audience: 'admin',   icon: '🎖', sort_order: 90 },
  { text: 'مشاركة مميزة في الإذاعة المدرسية', type: 'positive', category: 'general',    audience: 'admin',   icon: '🎤', sort_order: 100 },
  { text: 'يستحق شهادة تقدير',              type: 'positive', category: 'general',      audience: 'admin',   icon: '📜', sort_order: 110 },

  // ===== NEGATIVE — both =====
  { text: 'عدم إحضار الواجب',         type: 'negative', category: 'academic',     audience: 'both',    icon: '📚', sort_order: 210 },
  { text: 'تأخر متكرر عن الحصة',      type: 'negative', category: 'attendance',   audience: 'both',    icon: '⏰', sort_order: 220 },
  { text: 'عدم الانتباه أثناء الشرح', type: 'negative', category: 'participation', audience: 'both',   icon: '😐', sort_order: 230 },
  { text: 'إخلال بنظام الفصل',        type: 'negative', category: 'behavior',     audience: 'both',    icon: '⚠️', sort_order: 240 },
  { text: 'غياب بدون عذر',             type: 'negative', category: 'attendance',   audience: 'both',    icon: '❌', sort_order: 250 },
  // NEGATIVE — teacher
  { text: 'لم يحضر الكتاب المدرسي',           type: 'negative', category: 'academic',     audience: 'teacher', icon: '📕', sort_order: 260 },
  { text: 'تشتيت زملائه أثناء الحصة',          type: 'negative', category: 'behavior',     audience: 'teacher', icon: '💬', sort_order: 270 },
  { text: 'استخدام الجوال في الحصة',           type: 'negative', category: 'behavior',     audience: 'teacher', icon: '📱', sort_order: 280 },
  { text: 'النوم أثناء الحصة',                 type: 'negative', category: 'participation', audience: 'teacher', icon: '😴', sort_order: 290 },
  // NEGATIVE — admin
  { text: 'مخالفة سلوكية تستوجب تنبيهاً رسمياً', type: 'negative', category: 'behavior',     audience: 'admin',   icon: '⚖️', sort_order: 300 },
  { text: 'تأخر متكرر يستوجب لقاء ولي الأمر',    type: 'negative', category: 'attendance',   audience: 'admin',   icon: '📋', sort_order: 310 },
  { text: 'خروج من المدرسة بدون إذن',           type: 'negative', category: 'attendance',   audience: 'admin',   icon: '🚫', sort_order: 320 },
  { text: 'استدعاء ولي الأمر للمقابلة',          type: 'negative', category: 'general',      audience: 'admin',   icon: '💼', sort_order: 330 },
  { text: 'مخالفة الزي المدرسي',                type: 'negative', category: 'general',      audience: 'admin',   icon: '👔', sort_order: 340 },
  { text: 'استخدام كلمات غير لائقة',             type: 'negative', category: 'behavior',     audience: 'admin',   icon: '🔇', sort_order: 350 },
];

(async () => {
  // Update existing rows to set audience='both' (in case migration default didn't catch them)
  await sb.from('note_templates').update({ audience: 'both' }).is('audience', null);

  let added = 0, updated = 0, skipped = 0;
  for (const t of TEMPLATES) {
    const { data: existing } = await sb
      .from('note_templates')
      .select('id, audience')
      .eq('text', t.text)
      .eq('type', t.type)
      .maybeSingle();

    if (existing) {
      if (existing.audience !== t.audience) {
        await sb.from('note_templates').update({ audience: t.audience, category: t.category, icon: t.icon, sort_order: t.sort_order }).eq('id', existing.id);
        updated++;
      } else {
        skipped++;
      }
    } else {
      const { error } = await sb.from('note_templates').insert({
        ...t,
        is_active: true,
      });
      if (error) console.log('FAIL:', t.text, error.message);
      else added++;
    }
  }

  const { data: all } = await sb.from('note_templates').select('audience');
  const counts = { admin: 0, teacher: 0, both: 0 };
  for (const r of all || []) counts[r.audience] = (counts[r.audience] || 0) + 1;

  console.log(`\n✓ تمت معالجة ${TEMPLATES.length} قالب`);
  console.log(`  أضيف:    ${added}`);
  console.log(`  حُدِّث:    ${updated}`);
  console.log(`  بدون تغيير: ${skipped}`);
  console.log(`\nالقوالب الكلية:`);
  console.log(`  للجميع:      ${counts.both}`);
  console.log(`  للإدارة فقط:  ${counts.admin}`);
  console.log(`  للمعلم فقط:   ${counts.teacher}`);
  console.log(`  المجموع:     ${(all || []).length}`);
})();
