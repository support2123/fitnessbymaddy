// Mask phone numbers for logs. Input: "+917082478374" → "+91XXX...374"
export function maskPhone(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.length < 6) return '***';
  const plus = s.startsWith('+') ? '+' : '';
  const digits = s.replace(/\D/g, '');
  const cc = digits.slice(0, 2);
  const tail = digits.slice(-3);
  return `${plus}${cc}XXX...${tail}`;
}

export function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Strip everything except digits and leading +
  const digits = s.replace(/[^\d+]/g, '');
  if (!digits) return null;
  return digits.startsWith('+') ? digits : `+${digits}`;
}
