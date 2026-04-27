'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// Web Speech API isn't in @types/dom yet under stable Next 14, declare the bits we use.
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
  length: number;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: { [index: number]: SpeechRecognitionResult; length: number };
}
interface SpeechRecognitionErrorEvent extends Event { error: string; message?: string }

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognitionInstance };
    webkitSpeechRecognition?: { new (): SpeechRecognitionInstance };
  }
}

export interface UseSpeechToTextOptions {
  lang?: string;          // default: 'ar-SA'
  continuous?: boolean;   // default: true (keep listening across pauses)
  interim?: boolean;      // default: true (show partial transcripts live)
}

export interface UseSpeechToTextReturn {
  supported: boolean;
  listening: boolean;
  transcript: string;     // committed text (final results joined)
  interim: string;        // current best-guess for the segment in progress
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * Browser-side speech-to-text via the Web Speech API.
 * Works on Chrome, Edge, and Safari. Requires HTTPS in production
 * (localhost is fine during dev). Fully free.
 */
export function useSpeechToText(opts: UseSpeechToTextOptions = {}): UseSpeechToTextReturn {
  const { lang = 'ar-SA', continuous = true, interim = true } = opts;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!Ctor);
  }, []);

  const start = useCallback(() => {
    setError(null);
    if (typeof window === 'undefined') return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      setError('المتصفح لا يدعم التعرف الصوتي. جرّب Chrome أو Edge.');
      return;
    }
    // Reuse existing instance if present.
    if (recRef.current) {
      try { recRef.current.abort(); } catch { /* ignore */ }
    }
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = interim;

    rec.onstart = () => setListening(true);
    rec.onend = () => { setListening(false); setInterim(''); };
    rec.onerror = (e) => {
      setListening(false);
      const code = e.error;
      const msg =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? 'يجب السماح للمتصفح باستخدام الميكروفون'
          : code === 'no-speech'
            ? 'لم يُلتقط أي صوت'
            : code === 'audio-capture'
              ? 'لم يُعثر على ميكروفون'
              : code === 'network'
                ? 'فشل الاتصال بخدمة التعرف الصوتي'
                : `حدث خطأ في التعرف الصوتي (${code})`;
      setError(msg);
    };
    rec.onresult = (e) => {
      let interimAcc = '';
      let finalAdd = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const piece = r[0]?.transcript ?? '';
        if (r.isFinal) finalAdd += piece;
        else interimAcc += piece;
      }
      if (finalAdd) {
        setTranscript((prev) => (prev ? prev + ' ' : '') + finalAdd.trim());
      }
      setInterim(interimAcc);
    };

    recRef.current = rec;
    try { rec.start(); } catch (e: any) {
      setError(e?.message || 'تعذر بدء التسجيل');
    }
  }, [lang, continuous, interim]);

  const stop = useCallback(() => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch { /* ignore */ }
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterim('');
    setError(null);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (recRef.current) {
        try { recRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, []);

  return { supported, listening, transcript, interim: interimText, error, start, stop, reset };
}
