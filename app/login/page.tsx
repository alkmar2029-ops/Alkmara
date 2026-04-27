'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import toast from 'react-hot-toast';
import { Fingerprint, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Pick the destination from role: teachers go to their portal, everyone
      // else lands on the admin dashboard.
      const metaRole = (data.user?.app_metadata as { role?: string } | null)?.role;
      let role = metaRole;
      if (!role) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('role')
          .eq('user_id', data.user?.id ?? '')
          .maybeSingle();
        role = (profile?.role as string) ?? 'viewer';
      }

      // Touch last_login_at on the profile (best-effort).
      if (data.user) {
        supabase.from('user_profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('user_id', data.user.id)
          .then(() => {});
      }

      toast.success('تم تسجيل الدخول بنجاح');
      router.push(role === 'teacher' ? '/teacher' : '/dashboard');
      router.refresh();
    } catch {
      toast.error('البريد الإلكتروني أو كلمة المرور غير صحيحة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-950 p-4 px-4">
      <div className="w-full max-w-md">
        <div className="card">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Fingerprint className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {process.env.NEXT_PUBLIC_TEACHER_ONLY === 'true' ? 'بوابة المعلم' : 'نظام حضور الطلاب'}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {process.env.NEXT_PUBLIC_TEACHER_ONLY === 'true' ? 'تسجيل غياب الحصص' : 'ZKTeco MB2000'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">البريد الإلكتروني</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="admin@example.com"
                required
                disabled={loading}
              />
            </div>
            <div>
              <label className="label">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input ps-10"
                  required
                  disabled={loading}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'جاري الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
