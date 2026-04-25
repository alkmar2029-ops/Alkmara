const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber, PageBreak, LevelFormat, VerticalAlign,
} = require('docx');

const DATA_DIR = path.join(__dirname, 'device-data');
const CSV_FILE = path.join(DATA_DIR, 'comparison-2026-04-18T18-22-44.csv');
const SUMMARY_FILE = path.join(DATA_DIR, 'summary-2026-04-18T18-22-44.json');
const OUT_FILE = path.join(DATA_DIR, 'تقرير-البصمات.docx');

// ---- Load data ----
const summary = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
const csvRaw = fs.readFileSync(CSV_FILE, 'utf8').replace(/^\uFEFF/, '');
const lines = csvRaw.trim().split('\n');
const rows = lines.slice(1).map(l => {
  const m = l.match(/^([^,]*),"([^"]*)",([YN-]),([YN-]),([YN-]),([YN-]),(\d+),(\d+)$/);
  if (!m) return null;
  return {
    userId: m[1],
    name: m[2],
    onD1: m[3], onD2: m[4],
    fpD1: m[5], fpD2: m[6],
    fpcD1: parseInt(m[7]), fpcD2: parseInt(m[8]),
    fpTotal: parseInt(m[7]) + parseInt(m[8]),
  };
}).filter(Boolean);

const bothFp = rows.filter(r => r.fpD1 === 'Y' && r.fpD2 === 'Y');
const oneFp = rows.filter(r => (r.fpD1 === 'Y') !== (r.fpD2 === 'Y'));
const noFp = rows.filter(r => r.fpD1 !== 'Y' && r.fpD2 !== 'Y');
const zeroIds = rows.filter(r => r.userId.startsWith('0')).map(r => ({
  ...r,
  newUserId: '9' + r.userId.slice(1),
}));

// Write mapping CSV
const mappingLines = ['oldUserId,newUserId,name,idLength,hasFp_D1,hasFp_D2'];
zeroIds.forEach(r => {
  mappingLines.push([r.userId, r.newUserId, `"${r.name.replace(/"/g, '""')}"`, r.userId.length, r.fpD1, r.fpD2].join(','));
});
fs.writeFileSync(path.join(DATA_DIR, 'ids-zero-to-nine-mapping.csv'), '\uFEFF' + mappingLines.join('\n'), 'utf8');

console.log(`Loaded ${rows.length} rows: both=${bothFp.length}, one=${oneFp.length}, none=${noFp.length}, zero=${zeroIds.length}`);

// ---- Helpers ----
const F_HEAD = 'Arial';
const rtl = { bidirectional: true, alignment: AlignmentType.RIGHT };

const border = { style: BorderStyle.SINGLE, size: 6, color: '8AB6D6' };
const tblBorders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function txt(str, opts = {}) {
  return new TextRun({ text: str, font: F_HEAD, rtl: true, ...opts });
}

function p(str, opts = {}) {
  const { bold, size, color, align, spacing, children } = opts;
  return new Paragraph({
    bidirectional: true,
    alignment: align || AlignmentType.RIGHT,
    spacing: spacing || { before: 60, after: 60 },
    children: children || [txt(str, { bold, size, color })],
  });
}

function h(str, level) {
  const sizeMap = { 1: 36, 2: 28, 3: 24 };
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 120 },
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    children: [txt(str, { bold: true, size: sizeMap[level] || 24, color: '1F4E79' })],
  });
}

function cellP(str, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: opts.align || AlignmentType.RIGHT,
    spacing: { before: 20, after: 20 },
    children: [txt(str, opts)],
  });
}

function mkCell(content, opts = {}) {
  const { width, shade, bold, color, align } = opts;
  const children = Array.isArray(content)
    ? content.map(c => cellP(c, { bold, color, align }))
    : [cellP(content, { bold, color, align })];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border },
    shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    children,
  });
}

// ---- Document content ----
const pageWidth = 11906; // A4
const pageContentWidth = pageWidth - 1440 * 2; // ~9026

// Title page
const titlePage = [
  new Paragraph({ spacing: { before: 2000, after: 0 }, alignment: AlignmentType.CENTER, children: [new TextRun('')] }),
  new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 },
    children: [txt('تقرير حالة بصمات الطلاب', { bold: true, size: 56, color: '1F4E79' })],
  }),
  new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [txt('أجهزة البصمة ZKTeco — مقارنة بين جهازين', { size: 32, color: '2E75B6' })],
  }),
  new Paragraph({
    bidirectional: true, alignment: AlignmentType.CENTER, spacing: { after: 2000 },
    children: [txt(`تاريخ التقرير: ${new Date().toLocaleDateString('ar-SA')}`, { size: 24, color: '595959' })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
];

// Device info table
const deviceTable = new Table({
  width: { size: pageContentWidth, type: WidthType.DXA },
  columnWidths: [3000, 3000, 3026],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        mkCell('البيان', { width: 3000, shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER }),
        mkCell('الجهاز الأول', { width: 3000, shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER }),
        mkCell('الجهاز الثاني', { width: 3026, shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER }),
      ],
    }),
    ...[
      ['الموديل', summary.devices[0].deviceName, summary.devices[1].deviceName],
      ['الرقم التسلسلي (Serial)', summary.devices[0].serial, summary.devices[1].serial],
      ['عنوان IP', summary.devices[0].ip, summary.devices[1].ip],
      ['إصدار البرنامج (Firmware)', summary.devices[0].firmware, summary.devices[1].firmware],
      ['عدد الطلاب المسجلين', String(summary.devices[0].userCount), String(summary.devices[1].userCount)],
      ['عدد الطلاب الذين لهم بصمة', String(summary.devices[0].usersWithFingerprint), String(summary.devices[1].usersWithFingerprint)],
      ['إجمالي قوالب البصمات', String(summary.devices[0].totalFingerTemplates), String(summary.devices[1].totalFingerTemplates)],
      ['سجلات الحضور', String(summary.devices[0].attendanceCount), String(summary.devices[1].attendanceCount)],
    ].map((r, i) => new TableRow({
      children: [
        mkCell(r[0], { width: 3000, shade: i % 2 === 0 ? 'E8F1F7' : 'FFFFFF', bold: true }),
        mkCell(r[1], { width: 3000, shade: i % 2 === 0 ? 'E8F1F7' : 'FFFFFF', align: AlignmentType.CENTER }),
        mkCell(r[2], { width: 3026, shade: i % 2 === 0 ? 'E8F1F7' : 'FFFFFF', align: AlignmentType.CENTER }),
      ],
    })),
  ],
});

// Stats table
const statsTable = new Table({
  width: { size: pageContentWidth, type: WidthType.DXA },
  columnWidths: [5000, 2000, 2026],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        mkCell('الفئة', { width: 5000, shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER }),
        mkCell('العدد', { width: 2000, shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER }),
        mkCell('النسبة', { width: 2026, shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER }),
      ],
    }),
    ...[
      ['الطلاب الذين لهم بصمتان (على الجهازين)', bothFp.length, 'C6EFCE'],
      ['الطلاب الذين لهم بصمة واحدة (على جهاز واحد فقط)', oneFp.length, 'FFEB9C'],
      ['الطلاب بدون بصمة نهائياً', noFp.length, 'FFC7CE'],
      ['الإجمالي', rows.length, 'D9E1F2'],
    ].map((r, idx) => new TableRow({
      children: [
        mkCell(r[0], { width: 5000, shade: r[2], bold: idx === 3 }),
        mkCell(String(r[1]), { width: 2000, shade: r[2], bold: true, align: AlignmentType.CENTER }),
        mkCell(((r[1] / rows.length) * 100).toFixed(1) + '%', { width: 2026, shade: r[2], align: AlignmentType.CENTER }),
      ],
    })),
  ],
});

// Zero-ID table — shows old ID → new ID mapping
function mkZeroIdTable(list) {
  const colWidths = [600, 3000, 1700, 1700, 1126];
  const header = ['#', 'اسم الطالب', 'الرقم الأصلي', 'الرقم بعد التعديل', 'الحالة'];

  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map((hd, i) => mkCell(hd, {
      width: colWidths[i], shade: '1F4E79', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER
    })),
  });

  const dataRows = list.map((r, i) => {
    const shade = i % 2 === 0 ? 'EAF3FA' : 'FFFFFF';
    const status = (r.fpD1 === 'Y' || r.fpD2 === 'Y') ? 'له بصمة' : 'بدون بصمة';
    const statusColor = (r.fpD1 === 'Y' || r.fpD2 === 'Y') ? '2E7D32' : 'C00000';
    return new TableRow({
      children: [
        mkCell(String(i + 1), { width: colWidths[0], shade, align: AlignmentType.CENTER }),
        mkCell(r.name || '—', { width: colWidths[1], shade }),
        mkCell(r.userId, { width: colWidths[2], shade, align: AlignmentType.CENTER, color: 'C00000' }),
        mkCell(r.newUserId, { width: colWidths[3], shade, align: AlignmentType.CENTER, bold: true, color: '2E7D32' }),
        mkCell(status, { width: colWidths[4], shade, align: AlignmentType.CENTER, color: statusColor, bold: true }),
      ],
    });
  });

  return new Table({
    width: { size: pageContentWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

// List tables
function mkStudentTable(list, showDeviceCol = false) {
  const colWidths = showDeviceCol ? [800, 3500, 2500, 2226] : [800, 4200, 2000, 2026];
  const header = showDeviceCol
    ? ['#', 'اسم الطالب', 'رقم الهوية', 'الجهاز']
    : ['#', 'اسم الطالب', 'رقم الهوية', 'عدد البصمات'];

  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map((h, i) => mkCell(h, {
      width: colWidths[i], shade: '2E75B6', color: 'FFFFFF', bold: true, align: AlignmentType.CENTER
    })),
  });

  const dataRows = list.map((r, i) => {
    const cells = [
      mkCell(String(i + 1), { width: colWidths[0], shade: i % 2 === 0 ? 'F4F8FB' : 'FFFFFF', align: AlignmentType.CENTER }),
      mkCell(r.name || '—', { width: colWidths[1], shade: i % 2 === 0 ? 'F4F8FB' : 'FFFFFF' }),
      mkCell(r.userId, { width: colWidths[2], shade: i % 2 === 0 ? 'F4F8FB' : 'FFFFFF', align: AlignmentType.CENTER }),
    ];
    if (showDeviceCol) {
      const which = r.fpD1 === 'Y' ? 'الأول' : 'الثاني';
      cells.push(mkCell(which, { width: colWidths[3], shade: i % 2 === 0 ? 'F4F8FB' : 'FFFFFF', align: AlignmentType.CENTER }));
    } else {
      cells.push(mkCell(String(r.fpTotal), { width: colWidths[3], shade: i % 2 === 0 ? 'F4F8FB' : 'FFFFFF', align: AlignmentType.CENTER, bold: true }));
    }
    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: pageContentWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

// Build document body
const body = [
  ...titlePage,

  // Overview
  h('ملخص عام', 1),
  p('يستعرض هذا التقرير حالة تسجيل البصمات للطلاب على جهازي البصمة ZKTeco الخاصين بالمدرسة. تمت مقارنة البيانات المسحوبة من الجهازين لتحديد الطلاب الذين لهم بصمة مكتملة، والطلاب الذين لديهم بصمة على جهاز واحد فقط، والطلاب الذين لم يتم تسجيل بصماتهم بعد.', { size: 24 }),

  // Devices
  h('معلومات الأجهزة', 2),
  deviceTable,
  p('', { spacing: { before: 120, after: 120 } }),

  // Stats
  h('الإحصائيات العامة', 2),
  statsTable,
  p('', { spacing: { before: 120, after: 120 } }),

  // Page break before detailed lists
  new Paragraph({ children: [new PageBreak()] }),

  // Section 1: both fingerprints
  h(`١. الطلاب الذين لهم بصمتان (${bothFp.length} طالب)`, 1),
  p('هؤلاء الطلاب تم تسجيل بصمتهم على الجهازين معاً — حالتهم مكتملة.', { size: 24 }),
  mkStudentTable(bothFp.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'))),
  new Paragraph({ children: [new PageBreak()] }),

  // Section 2: single fingerprint
  h(`٢. الطلاب الذين لهم بصمة واحدة (${oneFp.length} طالب)`, 1),
  p('هؤلاء الطلاب مسجّلة بصمتهم على جهاز واحد فقط — يحتاجون إلى إضافة البصمة على الجهاز الآخر لاكتمال بياناتهم.', { size: 24 }),
  mkStudentTable(oneFp.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar')), true),
  new Paragraph({ children: [new PageBreak()] }),

  // Section 3: no fingerprint
  h(`٣. الطلاب بدون بصمة (${noFp.length} طالب)`, 1),
  p('هؤلاء الطلاب لم يتم تسجيل بصماتهم على أي من الجهازين — يجب تسجيل بصماتهم في أقرب وقت.', { size: 24 }),
  mkStudentTable(noFp.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'))),
  new Paragraph({ children: [new PageBreak()] }),

  // Section 4: zero-prefix IDs with replacement
  h(`٤. الطلاب الذين أرقامهم تبدأ بصفر — مع التعديل المقترح (${zeroIds.length} طالب)`, 1),
  p('تم رصد هؤلاء الطلاب لأن أرقام هوياتهم تبدأ بصفر. الاقتراح: استبدال الصفر الأول بالرقم ٩ ليصبح الرقم صالحاً للاستخدام.', { size: 24 }),
  p('الرقم الأصلي باللون الأحمر — الرقم بعد التعديل باللون الأخضر.', { size: 22, color: '595959' }),
  mkZeroIdTable(zeroIds.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'))),
];

// ---- Build document ----
const doc = new Document({
  creator: 'ZKTeco System',
  title: 'تقرير حالة بصمات الطلاب',
  description: 'Fingerprint Status Report',
  styles: {
    default: {
      document: { run: { font: F_HEAD, size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: F_HEAD, color: '1F4E79' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0, alignment: AlignmentType.CENTER },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: F_HEAD, color: '2E75B6' },
        paragraph: { spacing: { before: 180, after: 90 }, outlineLevel: 1, alignment: AlignmentType.CENTER },
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
      bidi: true,
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          bidirectional: true, alignment: AlignmentType.CENTER,
          children: [txt('نظام حضور الطلاب — ZKTeco', { size: 18, color: '808080' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          bidirectional: true, alignment: AlignmentType.CENTER,
          children: [
            txt('صفحة ', { size: 18, color: '808080' }),
            new TextRun({ font: F_HEAD, rtl: true, size: 18, color: '808080', children: [PageNumber.CURRENT] }),
            txt(' من ', { size: 18, color: '808080' }),
            new TextRun({ font: F_HEAD, rtl: true, size: 18, color: '808080', children: [PageNumber.TOTAL_PAGES] }),
          ],
        })],
      }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`\n[✓] Report saved: ${OUT_FILE}`);
  console.log(`    Size: ${(buf.length / 1024).toFixed(1)} KB`);
  console.log(`    Sections: both=${bothFp.length} | one=${oneFp.length} | none=${noFp.length} | total=${rows.length}`);
}).catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
