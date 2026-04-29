'use client';

import { useMemo } from 'react';
import toast from 'react-hot-toast';
import { Copy, Mail, Key, Link as LinkIcon, FileText, MessageCircle, Send } from 'lucide-react';

interface ExtractedFields {
  email: string | null;
  password: string | null;
  link: string | null;
  // Some templates expose the portal URL twice (visit + login link); first match is fine.
}

/**
 * Parses a WhatsApp message body and pulls out the bits an admin most often
 * needs to grab quickly: the teacher's email, the auto-generated password,
 * and any portal link. Heuristics are forgiving — they tolerate the various
 * label spellings the codebase uses ("كلمة السر" / "كلمة المرور" / "كلمة السر
 * الجديدة" / "Password" / "الباسوورد").
 *
 * Returns nulls when a field isn't found rather than empty strings; callers
 * use truthy checks to decide whether to render the chip.
 */
export function extractMessageFields(body: string): ExtractedFields {
  if (!body) return { email: null, password: null, link: null };

  // Email — single-line, RFC-lite pattern.
  const emailMatch = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);

  // First http(s) link — portals / registration pages.
  const linkMatch = body.match(/https?:\/\/[^\s]+/);

  // Password — line-by-line scan is far more reliable than a single regex
  // when the value sits on a separate line. We look for any line that
  // mentions a password-label keyword, then grab the captured token (same
  // line after ":" or the next non-empty line).
  const password = extractPasswordLineByLine(body);

  return {
    email: emailMatch?.[0] || null,
    password,
    link: linkMatch?.[0] || null,
  };
}

/**
 * Walks the message line by line. When we find a line that contains any of
 * the known password labels, we try to recover the actual value from:
 *   1. The same line, after a ":" — e.g. "كلمة السر: aBc123"
 *   2. The next non-empty line — the standard template form:
 *        🔑 كلمة السر الجديدة:
 *        aBc123$Xy
 * Returns the token if it looks like a password (6-40 chars, no whitespace).
 */
function extractPasswordLineByLine(body: string): string | null {
  // Normalize zero-width / RTL marker chars that sometimes hitchhike from
  // copy-paste — they break trim()/length checks otherwise.
  const cleaned = body.replace(/[​-‏‪-‮﻿]/g, '');

  const lines = cleaned.split('\n');
  // Match any of the labels we use. `i` flag covers "Password" / "PASSWORD".
  const labelRe = /(?:كلمة\s*(?:السر|المرور)|الباسوورد|باسورد|password)/i;

  // A "looks like password" check — printable ascii-ish, no whitespace,
  // 6-40 chars. generatePassword() emits 12 chars in this range so 6 is a
  // safe lower bound that also accepts manually-set short passwords.
  const looksLikePassword = (s: string) => /^[\S]{6,40}$/.test(s);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRe.test(line)) continue;

    // 1. Same-line value after the last colon.
    const sameLine = line.split(':').pop()?.trim();
    if (sameLine && looksLikePassword(sameLine)) return sameLine;

    // 2. Next non-empty line.
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const cand = lines[j].trim();
      if (!cand) continue;
      if (looksLikePassword(cand)) return cand;
      break;  // first non-empty line that doesn't match — give up
    }
  }
  return null;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`✓ تم نسخ ${label}`, { duration: 2000 });
  } catch {
    toast.error('تعذّر النسخ — تأكد من تفعيل صلاحية الحافظة');
  }
}

interface Props {
  body: string;
  /** Hide the action chip row — useful when the parent layout already
   *  shows context and just wants the formatted body. */
  hideActions?: boolean;
  /** Compact = smaller text and tighter padding (good for log row preview). */
  compact?: boolean;
  /** When supplied, surfaces a "Send via WhatsApp" chip that opens
   *  wa.me/<phone>?text=<body> in a new tab. Use the original recipient
   *  phone from whatsapp_messages.recipient_phone. */
  recipientPhone?: string | null;
}

/**
 * Build a wa.me deep link with the message text pre-filled. Strips
 * non-digits from the phone (wa.me wants pure E.164 without "+"),
 * URL-encodes the body. Works on mobile (opens app) and desktop
 * (opens WhatsApp Web).
 */
function buildWaLink(phone: string, body: string): string {
  const digits = String(phone).replace(/\D/g, '');
  const text = encodeURIComponent(body);
  return `https://wa.me/${digits}?text=${text}`;
}

/**
 * Renders a WhatsApp message body inside a styled box and surfaces detected
 * credentials as one-click copy chips above it. Falls back to a plain "Copy
 * full message" chip when no fields are detected, so the component is always
 * useful — never invisible UI.
 */
export default function MessageBodyViewer({ body, hideActions, compact, recipientPhone }: Props) {
  const fields = useMemo(() => extractMessageFields(body), [body]);
  const waLink = recipientPhone ? buildWaLink(recipientPhone, body) : null;

  return (
    <div className="space-y-2">
      {!hideActions && (
        <div className="flex flex-wrap gap-1.5">
          {/* Manual WhatsApp send — opens wa.me with the body pre-filled.
              Especially useful for failed sends: admin clicks → WhatsApp Web
              opens → message ready → admin hits Send manually. */}
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30 dark:hover:bg-green-500/25 transition-colors"
              title="يفتح واتساب مع الرسالة جاهزة للإرسال"
            >
              <Send className="w-3.5 h-3.5" />
              <span>إرسال يدوي عبر واتساب</span>
            </a>
          )}
          {fields.email && (
            <CopyChip
              icon={Mail}
              label="نسخ البريد"
              value={fields.email}
              onClick={() => copyToClipboard(fields.email!, 'البريد')}
              tone="blue"
            />
          )}
          {fields.password && (
            <CopyChip
              icon={Key}
              label="نسخ الباسوورد"
              value={fields.password}
              onClick={() => copyToClipboard(fields.password!, 'كلمة السر')}
              tone="amber"
              monospace
            />
          )}
          {fields.link && (
            <CopyChip
              icon={LinkIcon}
              label="نسخ الرابط"
              value={fields.link}
              onClick={() => copyToClipboard(fields.link!, 'الرابط')}
              tone="indigo"
            />
          )}
          <CopyChip
            icon={FileText}
            label="نسخ الكل"
            value=""
            onClick={() => copyToClipboard(body, 'الرسالة الكاملة')}
            tone="gray"
          />
          {fields.email && fields.password && (
            <CopyChip
              icon={MessageCircle}
              label="نسخ بصيغة بطاقة"
              value=""
              onClick={() => {
                const card = [
                  fields.email && `📧 البريد: ${fields.email}`,
                  fields.password && `🔐 كلمة السر: ${fields.password}`,
                  fields.link && `🔗 الرابط: ${fields.link}`,
                ].filter(Boolean).join('\n');
                copyToClipboard(card, 'بطاقة بيانات الدخول');
              }}
              tone="green"
            />
          )}
        </div>
      )}

      <pre
        className={`whitespace-pre-wrap font-sans bg-gray-50 dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 ${
          compact ? 'text-xs leading-relaxed' : 'text-sm leading-relaxed'
        }`}
        dir="auto"
      >
        {body}
      </pre>
    </div>
  );
}

// =================================================================
// Internal: a single copy chip that previews its value on hover and
// fires the onClick. The "preview" tooltip lets admin verify the
// detected value is right before clicking.
// =================================================================
function CopyChip({
  icon: Icon, label, value, onClick, tone, monospace,
}: {
  icon: any;
  label: string;
  value: string;
  onClick: () => void;
  tone: 'blue' | 'amber' | 'indigo' | 'gray' | 'green';
  monospace?: boolean;
}) {
  const cls = {
    blue:   'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30 dark:hover:bg-blue-500/25',
    amber:  'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30 dark:hover:bg-amber-500/25',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30 dark:hover:bg-indigo-500/25',
    gray:   'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-gray-700',
    green:  'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30 dark:hover:bg-green-500/25',
  }[tone];

  return (
    <button
      onClick={onClick}
      title={value || undefined}
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${cls}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
      {value && (
        <span
          className={`opacity-70 truncate max-w-[120px] ${monospace ? 'font-mono' : ''}`}
          dir="ltr"
        >
          {value}
        </span>
      )}
      <Copy className="w-3 h-3 opacity-60" />
    </button>
  );
}
