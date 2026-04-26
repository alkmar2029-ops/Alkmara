'use client';

import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Upload, Download, FileSpreadsheet, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { MAX_IMPORT_ROWS } from '@/lib/validations/schemas';

interface ImportModalProps {
  grades: any[];
  settings?: any;
  onClose: () => void;
  onDone: () => void;
}

function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], father_name: '', last_name: '' };
  if (parts.length === 2) return { first_name: parts[0], father_name: '', last_name: parts[1] };
  return { first_name: parts[0], father_name: parts.slice(1, -1).join(' '), last_name: parts[parts.length - 1] };
}

function gradeCodeToName(code: string): string {
  const num = parseInt(code.substring(0, 2));
  const m: Record<number, string> = {
    1:'الأول ابتدائي',2:'الثاني ابتدائي',3:'الثالث ابتدائي',4:'الرابع ابتدائي',5:'الخامس ابتدائي',6:'السادس ابتدائي',
    7:'الأول متوسط',8:'الثاني متوسط',9:'الثالث متوسط',10:'الأول ثانوي',11:'الثاني ثانوي',12:'الثالث ثانوي',
  };
  return m[num] || `الصف ${num}`;
}

export default function ImportModal({ grades, onClose, onDone }: ImportModalProps) {
  const [step, setStep] = useState(1);
  const [importType, setImportType] = useState<'specific' | 'full'>('specific');
  const [gradeId, setGradeId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [, setParsedData] = useState<any[]>([]);
  const [validationResults, setValidationResults] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: importSections } = useQuery({
    queryKey: ['sections', gradeId],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeId}`).then(r => r.json()).then(r => r.data),
    enabled: !!gradeId,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Mitigation for SheetJS prototype-pollution / ReDoS advisories
    // (no upstream patch available): reject before parsing if size, extension,
    // or MIME look wrong — and cap rows after parsing.
    const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
    if (file.size === 0) {
      toast.error('الملف فارغ');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error('حجم الملف يتجاوز 5 ميغابايت');
      return;
    }
    const allowedExt = ['.xlsx', '.xls', '.csv'];
    const lowerName = file.name.toLowerCase();
    if (!allowedExt.some(ext => lowerName.endsWith(ext))) {
      toast.error('نوع الملف غير مدعوم');
      return;
    }
    const allowedMime = new Set([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
      'application/octet-stream',
      '',
    ]);
    if (file.type && !allowedMime.has(file.type)) {
      toast.error('نوع الملف غير مدعوم');
      return;
    }
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      // dense:true uses arrays internally instead of mutating prototypes
      const workbook = XLSX.read(data, { dense: true });
      let rows: any[] = [];
      let isNoorFormat = false;
      if (workbook.SheetNames.length >= 2) {
        const sheet2 = workbook.Sheets[workbook.SheetNames[1]];
        const rawRows: any[] = XLSX.utils.sheet_to_json(sheet2, { header: 1 });
        const headerRow = rawRows[3];
        if (headerRow && (headerRow.includes('اسم الطالب') || headerRow.includes('رقم الطالب'))) {
          isNoorFormat = true;
          const noorLimit = Math.min(rawRows.length, 4 + MAX_IMPORT_ROWS);
          for (let i = 4; i < noorLimit; i++) {
            const r = rawRows[i];
            if (!r || !r[5]) continue;
            rows.push({ 'رقم الطالب': r[5], 'اسم الطالب': r[4], 'رقم الصف': r[3], 'الفصل': r[2], 'الجوال': r[1] });
          }
        }
      }
      if (!isNoorFormat) { const sheet = workbook.Sheets[workbook.SheetNames[0]]; rows = XLSX.utils.sheet_to_json(sheet); }
      if (rows.length === 0) { toast.error('الملف فارغ أو لا يحتوي بيانات طلاب'); return; }
      if (rows.length > MAX_IMPORT_ROWS) {
        toast.error(`عدد الصفوف يتجاوز الحد الأقصى المسموح (${MAX_IMPORT_ROWS})`);
        return;
      }

      const mapped = rows.map((row: any) => {
        const fullName = String(row['اسم الطالب'] || row['اسم_الطالب'] || '').trim();
        let first_name = String(row['الاسم_الاول'] || row['الاسم الأول'] || row['first_name'] || '').trim();
        let father_name = String(row['اسم_الاب'] || row['اسم الأب'] || row['father_name'] || '').trim();
        let last_name = String(row['اسم_العائلة'] || row['اسم العائلة'] || row['last_name'] || '').trim();
        if (fullName && !first_name) { const s = splitFullName(fullName); first_name = s.first_name; father_name = s.father_name; last_name = s.last_name; }
        const student_id = String(row['رقم الطالب'] || row['رقم_الطالب'] || row['رقم_الهوية'] || row['رقم الهوية'] || row['student_id'] || row['id'] || '').trim();
        const gradeCode = String(row['رقم الصف'] || row['رقم_الصف'] || '').trim();
        const grade = gradeCode ? gradeCodeToName(gradeCode) : String(row['الصف'] || row['grade'] || '').trim();
        const section = String(row['الفصل'] || row['الشعبة'] || row['section'] || '').trim();
        const phone = String(row['الجوال'] || row['رقم_الجوال'] || row['رقم الجوال'] || row['phone'] || '').trim();
        return { student_id, first_name, father_name, last_name, phone, grade, section };
      });
      setParsedData(mapped);
      if (isNoorFormat || mapped.some(r => r.grade || r.section)) setImportType('full');

      const validated = mapped.map((row, i) => {
        const errors: string[] = [];
        if (!row.student_id || !/^\d{7,10}$/.test(row.student_id)) errors.push('رقم الهوية غير صحيح');
        if (!row.first_name) errors.push('الاسم مطلوب');
        return { ...row, rowNum: i + 1, errors, status: errors.length === 0 ? 'valid' : 'error' };
      });
      const seenIds = new Set<string>();
      validated.forEach(row => {
        if (row.status === 'valid') { if (seenIds.has(row.student_id)) { row.status = 'duplicate'; row.errors.push('مكرر في الملف'); } else seenIds.add(row.student_id); }
      });
      setValidationResults(validated);
      toast.success(`تم قراءة ${mapped.length} طالب من الملف`);
      setStep(4);
    } catch { toast.error('خطأ في قراءة الملف'); }
  };

  const handleImport = async () => {
    setImporting(true);
    const validRows = validationResults.filter(r => r.status === 'valid');
    const students = validRows.map(r => ({ student_id: r.student_id, first_name: r.first_name, father_name: r.father_name, last_name: r.last_name, phone: r.phone || '', grade_name: r.grade || '', section_name: r.section || '' }));
    try {
      const res = await fetch('/api/students/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ students, grade_id: importType === 'specific' ? parseInt(gradeId) : undefined, section_id: importType === 'specific' ? parseInt(sectionId) : undefined, auto_create_grades: importType === 'full' }) });
      if (!res.ok) throw new Error('Import failed');
      const result = await res.json();
      setImportResult(result.data);
      setStep(5);
      toast.success(`تم استيراد ${result.data.imported} طالب`);
    } catch { toast.error('خطأ أثناء الاستيراد'); } finally { setImporting(false); }
  };

  const downloadTemplate = () => {
    import('xlsx').then(XLSX => {
      const headers = importType === 'specific'
        ? [{ 'رقم الهوية': '', 'الاسم الأول': '', 'اسم الأب': '', 'اسم العائلة': '', 'رقم الجوال': '' }]
        : [{ 'رقم الهوية': '', 'الاسم الأول': '', 'اسم الأب': '', 'اسم العائلة': '', 'الصف': '', 'الشعبة': '', 'رقم الجوال': '' }];
      const ws = XLSX.utils.json_to_sheet(headers);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'الطلاب');
      XLSX.writeFile(wb, 'نموذج_استيراد_الطلاب.xlsx');
    });
  };

  const validCount = validationResults.filter(r => r.status === 'valid').length;
  const errorCount = validationResults.filter(r => r.status === 'error').length;
  const duplicateCount = validationResults.filter(r => r.status === 'duplicate').length;

  return (
    <Modal isOpen={true} onClose={onClose} title="استيراد طلاب من Excel" maxWidth="max-w-2xl">
      {step === 1 && (<div className="space-y-4"><p className="text-sm text-gray-500 dark:text-gray-400">اختر طريقة الاستيراد:</p>
        <label className={`flex gap-3 p-4 rounded-lg border-2 cursor-pointer ${importType === 'specific' ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15' : 'border-gray-200 dark:border-gray-800'}`}><input type="radio" checked={importType === 'specific'} onChange={() => setImportType('specific')} /><div><p className="font-medium text-gray-900 dark:text-gray-100">استيراد لشعبة محددة</p><p className="text-sm text-gray-500 dark:text-gray-400">حدد الصف والشعبة، ثم ارفع الملف</p></div></label>
        <label className={`flex gap-3 p-4 rounded-lg border-2 cursor-pointer ${importType === 'full' ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/15' : 'border-gray-200 dark:border-gray-800'}`}><input type="radio" checked={importType === 'full'} onChange={() => setImportType('full')} /><div><p className="font-medium text-gray-900 dark:text-gray-100">استيراد شامل</p><p className="text-sm text-gray-500 dark:text-gray-400">ارفع ملف يحتوي الصف والشعبة لكل طالب</p></div></label>
        <div className="flex justify-end"><button onClick={() => setStep(importType === 'specific' ? 2 : 3)} className="btn-primary w-full sm:w-auto">التالي</button></div></div>)}

      {step === 2 && (<div className="space-y-4">
        <div><label className="label">الصف *</label><select value={gradeId} onChange={e => { setGradeId(e.target.value); setSectionId(''); }} className="input"><option value="">اختر الصف</option>{grades.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        <div><label className="label">الشعبة *</label><select value={sectionId} onChange={e => setSectionId(e.target.value)} className="input" disabled={!gradeId}><option value="">اختر الشعبة</option>{(importSections || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="flex flex-col sm:flex-row sm:justify-between gap-2"><button onClick={() => setStep(1)} className="btn-secondary w-full sm:w-auto">السابق</button><button onClick={() => setStep(3)} disabled={!gradeId || !sectionId} className="btn-primary w-full sm:w-auto">التالي</button></div></div>)}

      {step === 3 && (<div className="space-y-4">
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-blue-400 transition-colors" onClick={() => fileInputRef.current?.click()}><FileSpreadsheet className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" /><p className="text-gray-600 dark:text-gray-300 font-medium">اسحب ملف Excel هنا أو اضغط للاختيار</p><p className="text-sm text-gray-400 dark:text-gray-500 mt-1">الصيغ: .xlsx, .xls, .csv</p></div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" />
        <button onClick={downloadTemplate} className="text-blue-600 dark:text-blue-400 text-sm hover:underline flex items-center gap-1"><Download className="w-3 h-3" /> تحميل نموذج Excel</button>
        <div className="flex justify-between"><button onClick={() => setStep(importType === 'specific' ? 2 : 1)} className="btn-secondary w-full sm:w-auto">السابق</button></div></div>)}

      {step === 4 && (<div className="space-y-4">
        <div className="flex flex-wrap gap-3 sm:gap-4"><div className="flex items-center gap-2 text-green-600 dark:text-green-400"><CheckCircle className="w-4 h-4" /> {validCount} صحيح</div><div className="flex items-center gap-2 text-red-600 dark:text-red-400"><XCircle className="w-4 h-4" /> {errorCount} خطأ</div><div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400"><AlertTriangle className="w-4 h-4" /> {duplicateCount} مكرر</div></div>
        <div className="max-h-80 overflow-y-auto overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-lg"><table className="w-full text-sm"><thead className="bg-gray-50 dark:bg-gray-900 sticky top-0"><tr><th className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">الحالة</th><th className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">رقم الهوية</th><th className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">الاسم</th><th className="px-3 py-2 text-right text-gray-700 dark:text-gray-200">الخطأ</th></tr></thead>
          <tbody>{validationResults.map((r, i) => (<tr key={i} className={`border-b border-gray-200 dark:border-gray-800 ${r.status === 'error' ? 'bg-red-50 dark:bg-red-500/15' : r.status === 'duplicate' ? 'bg-yellow-50 dark:bg-yellow-500/15' : ''}`}><td className="px-3 py-2">{r.status === 'valid' && <CheckCircle className="w-4 h-4 text-green-500" />}{r.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}{r.status === 'duplicate' && <AlertTriangle className="w-4 h-4 text-yellow-500" />}</td><td className="px-3 py-2 font-mono text-gray-900 dark:text-gray-100">{r.student_id}</td><td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.first_name} {r.father_name} {r.last_name}</td><td className="px-3 py-2 text-red-600 dark:text-red-400 text-xs">{r.errors.join(', ')}</td></tr>))}</tbody></table></div>
        <div className="flex flex-col sm:flex-row sm:justify-between gap-2"><button onClick={() => setStep(3)} className="btn-secondary w-full sm:w-auto">السابق</button><button onClick={handleImport} disabled={importing || validCount === 0} className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"><Upload className="w-4 h-4" />{importing ? 'جاري الاستيراد...' : `استيراد ${validCount} طالب`}</button></div></div>)}

      {step === 5 && importResult && (<div className="space-y-4 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto" /><h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">تم الاستيراد بنجاح</h3>
        <div className="flex flex-wrap gap-4 sm:gap-6 justify-center"><div><p className="text-2xl font-bold text-green-600 dark:text-green-400">{importResult.imported}</p><p className="text-sm text-gray-500 dark:text-gray-400">تم استيرادهم</p></div><div><p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{importResult.skipped}</p><p className="text-sm text-gray-500 dark:text-gray-400">تم تخطيهم</p></div><div><p className="text-2xl font-bold text-red-600 dark:text-red-400">{importResult.errors?.length || 0}</p><p className="text-sm text-gray-500 dark:text-gray-400">أخطاء</p></div></div>
        {importResult.errors?.length > 0 && (<div className="text-right bg-red-50 dark:bg-red-500/15 p-3 rounded-lg max-h-32 overflow-y-auto">{importResult.errors.map((e: string, i: number) => <p key={i} className="text-sm text-red-600 dark:text-red-400">{e}</p>)}</div>)}
        <button onClick={onDone} className="btn-primary w-full sm:w-auto">إغلاق</button></div>)}
    </Modal>
  );
}
