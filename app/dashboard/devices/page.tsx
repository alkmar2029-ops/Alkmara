'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, WifiOff, Clock, Download, Power, Upload, BarChart3, CheckCircle, XCircle, Users } from 'lucide-react';
import { STATUS_MAP, STAGE_LABELS } from '@/lib/utils/helpers';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';

export default function DevicesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showCompare, setShowCompare] = useState<number | null>(null);

  const { data: devices, isLoading, isError, error } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await fetch('/api/devices');
      if (!res.ok) throw new Error('فشل في تحميل الأجهزة');
      const r = await res.json();
      return r.data;
    },
    refetchInterval: 10000,
  });

  const actionMutation = useMutation({
    mutationFn: async ({ id, action, date }: { id: number; action: string; date?: string }) => {
      const res = await fetch(`/api/devices/${id}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['devices'] });
      if (data.message) toast.success(data.message);
      if (data.data?.synced !== undefined) toast.success(`تم سحب ${data.data.synced} سجل`);
      if (data.data?.success !== undefined && variables.action === 'push-users') {
        toast.success(`تم إرسال ${data.data.success} طالب من أصل ${data.data.total}`);
      }
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createMutation = useMutation({
    mutationFn: async (d: any) => {
      const res = await fetch('/api/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (!res.ok) throw new Error((await res.json()).error);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['devices'] }); toast.success('تم إضافة الجهاز'); setShowForm(false); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">أجهزة البصمة</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> إضافة جهاز</button>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {(error as Error)?.message || 'حدث خطأ أثناء تحميل الأجهزة'}
        </div>
      )}

      {isLoading ? <SkeletonTable rows={3} cols={3} /> : (
        <>
          {(!devices || devices.length === 0) ? (
            <EmptyState title="لا توجد أجهزة مسجلة" description="اضغط إضافة جهاز للبدء" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {devices.map((d: any) => {
                  const st = STATUS_MAP[d.status] || STATUS_MAP['disconnected'];
                  return (
                    <div key={d.id} className="card">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold">{d.name}</h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </div>
                      <div className="text-sm text-gray-500 space-y-1 mb-2">
                        <p>IP: {d.ip_address}:{d.port}</p>
                        <p>الموقع: {d.location || '-'}</p>
                        <p>الموديل: {d.model}</p>
                      </div>
                      {/* Linked section */}
                      {d.section_name ? (
                        <div className="bg-blue-50 text-blue-700 text-sm px-3 py-2 rounded-lg mb-3 font-medium">
                          الشُعبة: {d.grade_name} {STAGE_LABELS[d.grade_stage] || ''} - {d.section_name}
                        </div>
                      ) : (
                        <div className="bg-yellow-50 text-yellow-700 text-sm px-3 py-2 rounded-lg mb-3">
                          لم يتم ربط الجهاز بشُعبة
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        {d.is_online ? (
                          <>
                            <button onClick={() => actionMutation.mutate({ id: d.id, action: 'disconnect' })} className="btn-secondary text-xs flex items-center gap-1"><WifiOff className="w-3 h-3" /> قطع</button>
                            <button onClick={() => actionMutation.mutate({ id: d.id, action: 'sync-time' })} className="btn-secondary text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> مزامنة</button>
                            {d.section_name && (
                              <>
                                <button onClick={() => actionMutation.mutate({ id: d.id, action: 'push-users' })} className="btn-primary text-xs flex items-center gap-1">
                                  <Upload className="w-3 h-3" /> إرسال الطلاب
                                </button>
                                <button onClick={() => actionMutation.mutate({ id: d.id, action: 'pull-logs' })} className="btn-secondary text-xs flex items-center gap-1">
                                  <Download className="w-3 h-3" /> سحب الحضور
                                </button>
                                <button onClick={() => setShowCompare(d.id)} className="btn-success text-xs flex items-center gap-1">
                                  <BarChart3 className="w-3 h-3" /> مقارنة الحضور
                                </button>
                              </>
                            )}
                          </>
                        ) : (
                          <button onClick={() => actionMutation.mutate({ id: d.id, action: 'connect' })} className="btn-success text-xs flex items-center gap-1"><Power className="w-3 h-3" /> اتصال</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
          )}
        </>
      )}

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="إضافة جهاز جديد" maxWidth="max-w-md">
        <DeviceFormContent onSubmit={(d: any) => createMutation.mutate(d)} onClose={() => setShowForm(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal isOpen={showCompare !== null} onClose={() => setShowCompare(null)} title="مقارنة الحضور" maxWidth="max-w-2xl">
        {showCompare !== null && <CompareModalContent deviceId={showCompare} />}
      </Modal>
    </div>
  );
}

// ==================== Device Form Content ====================
function DeviceFormContent({ onSubmit, onClose, loading }: any) {
  const [f, setF] = useState({ name: '', ip_address: '', port: 4370, model: 'MB2000', location: '', section_id: '' });
  const [gradeId, setGradeId] = useState('');

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => fetch('/api/settings').then(r => r.json()).then(r => r.data) });
  const { data: grades } = useQuery({
    queryKey: ['grades', settings?.stage],
    queryFn: () => fetch(`/api/grades?stage=${settings?.stage}`).then(r => r.json()).then(r => r.data),
    enabled: !!settings?.stage,
  });
  const { data: sections } = useQuery({
    queryKey: ['sections', gradeId],
    queryFn: () => fetch(`/api/sections?grade_id=${gradeId}`).then(r => r.json()).then(r => r.data),
    enabled: !!gradeId,
  });

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ ...f, section_id: f.section_id ? parseInt(f.section_id) : null }); }} className="space-y-3">
      <div><label className="label">اسم الجهاز *</label><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className="input" required placeholder="جهاز القاعة 101" /></div>
      <div><label className="label">عنوان IP *</label><input value={f.ip_address} onChange={e => setF({ ...f, ip_address: e.target.value })} className="input" required placeholder="192.168.1.100" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">المنفذ</label><input type="number" value={f.port} onChange={e => setF({ ...f, port: +e.target.value })} className="input" /></div>
        <div><label className="label">الموديل</label><input value={f.model} onChange={e => setF({ ...f, model: e.target.value })} className="input" /></div>
      </div>
      <div><label className="label">الموقع</label><input value={f.location} onChange={e => setF({ ...f, location: e.target.value })} className="input" placeholder="المبنى A" /></div>

      <div className="border-t pt-3 mt-3">
        <p className="label font-semibold mb-2">ربط الجهاز بشُعبة (اختياري)</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">الصف</label>
            <select value={gradeId} onChange={e => { setGradeId(e.target.value); setF({ ...f, section_id: '' }); }} className="input">
              <option value="">اختر الصف</option>
              {(grades || []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div><label className="label">الشُعبة</label>
            <select value={f.section_id} onChange={e => setF({ ...f, section_id: e.target.value })} className="input" disabled={!gradeId}>
              <option value="">اختر</option>
              {(sections || []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'جاري الحفظ...' : 'حفظ'}</button>
        <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
      </div>
    </form>
  );
}

// ==================== Compare Modal Content ====================
function CompareModalContent({ deviceId }: { deviceId: number }) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const compareMutation = useMutation({
    mutationFn: async (compareDate: string) => {
      const res = await fetch(`/api/devices/${deviceId}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compare', date: compareDate }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      return result.data;
    },
  });

  // Trigger on mount and when date changes
  const handleDateChange = (newDate: string) => {
    setDate(newDate);
    compareMutation.mutate(newDate);
  };

  // Trigger initial load
  useEffect(() => {
    compareMutation.mutate(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = compareMutation.data;
  const isLoading = compareMutation.isPending;

  return (
    <div>
      <div className="mb-4">
        <input type="date" value={date} onChange={e => handleDateChange(e.target.value)} className="input max-w-xs" />
      </div>

      {compareMutation.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm mb-4">
          {(compareMutation.error as Error)?.message || 'حدث خطأ أثناء المقارنة'}
        </div>
      )}

      {isLoading ? <div className="text-center py-8 text-gray-400">جاري التحميل...</div> : data ? (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{data.present_count}</p>
              <p className="text-sm text-green-700">حاضر</p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{data.absent_count}</p>
              <p className="text-sm text-red-700">غائب</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{data.total}</p>
              <p className="text-sm text-blue-700">الإجمالي</p>
            </div>
          </div>

          {/* Absent list */}
          {data.absent.length > 0 && (
            <div>
              <h4 className="font-semibold text-red-600 mb-2 flex items-center gap-2"><XCircle className="w-4 h-4" /> الغائبون ({data.absent.length})</h4>
              <div className="bg-red-50 rounded-lg divide-y divide-red-100">
                {data.absent.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="font-mono text-sm text-gray-500 w-24">{s.student_id}</span>
                    <span className="flex-1">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Present list */}
          {data.present.length > 0 && (
            <div>
              <h4 className="font-semibold text-green-600 mb-2 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> الحاضرون ({data.present.length})</h4>
              <div className="bg-green-50 rounded-lg divide-y divide-green-100">
                {data.present.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="font-mono text-sm text-gray-500 w-24">{s.student_id}</span>
                    <span className="flex-1">{s.name}</span>
                    <span className="text-xs text-gray-500">{s.punch_time ? new Date(s.punch_time).toLocaleTimeString('ar-SA') : ''}</span>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.total === 0 && (
            <div className="text-center py-8 text-gray-400">
              <Users className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>لا يوجد طلاب في هذه الشُعبة</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
