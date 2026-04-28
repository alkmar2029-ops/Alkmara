'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';

/**
 * Banner shown on device-management pages when the app is loaded from a cloud
 * deployment (Vercel) instead of the local school server. The fingerprint
 * devices live on a private LAN so cloud requests can't reach them — surface
 * that limitation clearly so the admin doesn't get cryptic timeout errors.
 *
 * Detection: window.location.hostname doesn't match localhost / 192.168.x /
 * 10.x / 127.0.0.1.
 */
export default function CloudDeploymentBanner({ feature }: { feature: string }) {
  const [isCloud, setIsCloud] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = window.location.hostname;
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    setIsCloud(!isLocal);
  }, []);

  if (!isCloud) return null;

  return (
    <div className="rounded-lg border-2 border-yellow-300 dark:border-yellow-500/40 bg-yellow-50 dark:bg-yellow-500/10 p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          <p className="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
            هذه الصفحة تحتاج تشغيل النظام محلياً
          </p>
          <p className="text-yellow-700 dark:text-yellow-300/90 leading-relaxed">
            {feature} يتطلب الاتصال بأجهزة البصمة على الشبكة المحلية للمدرسة
            — ولا يمكن تنفيذها من السيرفر السحابي.
          </p>
          <p className="text-yellow-700 dark:text-yellow-300/90 mt-2 text-xs">
            افتح النظام على جهاز الإدارة المتصل بشبكة المدرسة:
            <code className="font-mono bg-yellow-100 dark:bg-yellow-500/20 px-1.5 py-0.5 rounded ms-1" dir="ltr">
              http://localhost:3001
            </code>
            <span className="ms-2 inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
              <ExternalLink className="w-3 h-3" />
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
