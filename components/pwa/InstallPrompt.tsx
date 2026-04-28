'use client';

import { useEffect, useState } from 'react';
import { Download, X, Share, Smartphone } from 'lucide-react';

// Type for the beforeinstallprompt event (not in standard DOM types yet).
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa.install.dismissed_at';
const RE_PROMPT_DAYS = 7;  // re-show after a week even if dismissed

/**
 * Install banner shown on the teacher portal:
 *   • Chrome/Edge/Android → uses beforeinstallprompt (native install dialog)
 *   • iOS Safari          → shows "tap Share → Add to Home Screen" hint
 *
 * Hides itself when the app is already running standalone (already installed)
 * or the user dismissed it recently.
 */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Already installed?
    const sa = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    setIsStandalone(sa);

    // iOS detection (Safari doesn't fire beforeinstallprompt).
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIos(ios);

    // Recently dismissed?
    try {
      const dismissedAt = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      const ageMs = Date.now() - dismissedAt;
      if (dismissedAt && ageMs < RE_PROMPT_DAYS * 24 * 3600 * 1000) {
        setDismissed(true);
      }
    } catch { /* ignore */ }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') {
      setDeferred(null);
    } else {
      // User dismissed the native dialog — record it.
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setDismissed(true);
    setShowIosHint(false);
  };

  // Don't show anything if installed or recently dismissed.
  if (isStandalone || dismissed) return null;

  // iOS path — show hint banner with Share-button instructions.
  if (isIos) {
    if (showIosHint) {
      return (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4">
          <div className="max-w-md mx-auto bg-white dark:bg-gray-900 border-2 border-blue-300 dark:border-blue-500/40 rounded-xl shadow-2xl p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-sm flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                ثبّت التطبيق على شاشتك الرئيسية
              </h3>
              <button onClick={handleDismiss} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="mt-3 text-sm space-y-1.5 text-gray-700 dark:text-gray-200">
              <li>1. اضغط على زر <Share className="w-3.5 h-3.5 inline mx-1 text-blue-600" /> <strong>مشاركة</strong> في Safari (أسفل الشاشة)</li>
              <li>2. اختر <strong>"إضافة إلى الشاشة الرئيسية"</strong></li>
              <li>3. اضغط <strong>"إضافة"</strong></li>
            </ol>
          </div>
        </div>
      );
    }
    return (
      <button
        onClick={() => setShowIosHint(true)}
        className="fixed bottom-4 inset-x-4 z-40 mx-auto max-w-sm flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white shadow-lg hover:bg-blue-700"
      >
        <Smartphone className="w-4 h-4" />
        <span className="flex-1 text-sm font-medium text-right">ثبّت التطبيق على جوالك</span>
        <Download className="w-4 h-4" />
      </button>
    );
  }

  // Chromium path — show button only when the browser sent beforeinstallprompt.
  if (!deferred) return null;

  return (
    <div className="fixed bottom-4 inset-x-4 z-40 mx-auto max-w-sm">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-600 text-white shadow-lg">
        <Smartphone className="w-5 h-5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">ثبّت التطبيق</p>
          <p className="text-[11px] opacity-90">يفتح أسرع ويعمل بدون متصفح</p>
        </div>
        <button
          onClick={handleInstall}
          className="px-3 py-1.5 rounded-lg bg-white text-blue-600 font-semibold text-sm hover:bg-blue-50"
        >
          تثبيت
        </button>
        <button onClick={handleDismiss} className="p-1 rounded hover:bg-blue-700" aria-label="إغلاق">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
