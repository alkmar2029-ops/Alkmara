'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowUp, Trash2, AlertTriangle, GraduationCap, Fingerprint } from 'lucide-react';
import { STAGE_LABELS } from '@/lib/utils/helpers';
import { SkeletonPage } from '@/components/ui/Skeleton';

export default function PromotePage() {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then(r => r.json()).then(r => r.data),
  });

  const { data: preview, isLoading, isError, error } = useQuery({
    queryKey: ['promote-preview'],
    queryFn: async () => {
      const res = await fetch('/api/students/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      return result.data;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const promoteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/students/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (data) => {
      toast.success(data.message);
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['promote-preview'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setShowConfirm(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <GraduationCap className="w-7 h-7 text-gray-400" />
        <div>
          <h2 className="text-2xl font-bold">ترقية الطلاب</h2>
          <p className="text-gray-500 text-sm">نقل الطلاب للصف التالي في بداية العام الدراسي الجديد</p>
        </div>
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-semibold mb-1">تنبيه مهم</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>سيتم <strong>حذف</strong> طلاب الصف الأخير (المتخرجين)</li>
            <li>سيتم <strong>ترقية</strong> باقي الطلاب للصف التالي</li>
            <li>سيتم <strong>إعادة تعيين</strong> حالة البصمة لجميع الطلاب</li>
            <li>يجب <strong>إعادة إرسال</strong> الطلاب للأجهزة بعد الترقية</li>
            <li>هذا الإجراء <strong>لا يمكن التراجع عنه</strong></li>
          </ul>
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {(error as Error)?.message || 'حدث خطأ أثناء تحميل المعاينة'}
        </div>
      )}

      {/* Preview */}
      {isLoading ? (
        <SkeletonPage />
      ) : preview ? (
        <div className="card">
          <h3 className="font-semibold text-lg mb-4">
            معاينة الترقية - المرحلة: {STAGE_LABELS[settings?.stage] || ''}
          </h3>

          <div className="space-y-3 mb-6">
            {preview.preview.map((item: any) => (
              <div key={item.grade_id} className={`flex items-center gap-4 p-4 rounded-lg border-2 ${
                item.action === 'delete' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'
              }`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  item.action === 'delete' ? 'bg-red-100' : 'bg-blue-100'
                }`}>
                  {item.action === 'delete' ? (
                    <Trash2 className="w-5 h-5 text-red-600" />
                  ) : (
                    <ArrowUp className="w-5 h-5 text-blue-600" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{item.grade_name} {STAGE_LABELS[settings?.stage] || ''}</p>
                  <p className={`text-sm ${item.action === 'delete' ? 'text-red-600' : 'text-blue-600'}`}>
                    {item.action_label}
                  </p>
                </div>
                <div className="text-start">
                  <p className="text-2xl font-bold">{item.student_count}</p>
                  <p className="text-xs text-gray-500">طالب</p>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{preview.total_students}</p>
              <p className="text-xs text-gray-500">إجمالي الطلاب</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-600">{preview.graduated_count}</p>
              <p className="text-xs text-red-600">سيتم حذفهم</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-600">{preview.total_students - preview.graduated_count}</p>
              <p className="text-xs text-blue-600">سيتم ترقيتهم</p>
            </div>
          </div>

          {preview.devices_to_clear > 0 && (
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              <Fingerprint className="w-4 h-4" />
              <span>{preview.devices_to_clear} جهاز سيتم إعادة تعيينه</span>
            </div>
          )}

          {!showConfirm ? (
            <button onClick={() => setShowConfirm(true)} className="btn-danger w-full flex items-center justify-center gap-2">
              <GraduationCap className="w-4 h-4" />
              بدء الترقية
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
              <p className="text-red-800 font-semibold">هل أنت متأكد؟ هذا الإجراء لا يمكن التراجع عنه.</p>
              <div className="flex gap-3">
                <button onClick={() => promoteMutation.mutate()} disabled={promoteMutation.isPending}
                  className="btn-danger flex-1 flex items-center justify-center gap-2">
                  {promoteMutation.isPending ? 'جاري الترقية...' : 'تأكيد الترقية'}
                </button>
                <button onClick={() => setShowConfirm(false)} className="btn-secondary">إلغاء</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">لا يوجد طلاب للترقية</div>
      )}
    </div>
  );
}
