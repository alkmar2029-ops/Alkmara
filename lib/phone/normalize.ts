/** Convert Arabic-Indic and Eastern Arabic-Indic digits to ASCII digits. */
export function toLatinDigits(input: string): string {
  return String(input || '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Normalize Saudi phone numbers to international form (9665XXXXXXXX). */
export function normalizePhone(phone: string): string {
  const digits = toLatinDigits(phone).replace(/\D/g, '');
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('05')) return '966' + digits.slice(1);
  if (digits.startsWith('5')) return '966' + digits;
  return digits;
}
