// Mask phone numbers for logs: +917082478374 → +91XXX...374
export function maskPhone(raw) {
  if (!raw) return '';
  const p = String(raw).replace(/[^\d+]/g, '');
  if (p.length < 6) return 'XXX';
  const head = p.startsWith('+') ? p.slice(0, 3) : p.slice(0, 2);
  const tail = p.slice(-3);
  return `${head}XXX...${tail}`;
}

export function normalizePhone(raw) {
  if (!raw) return '';
  let p = String(raw).trim().replace(/[\s\-()]/g, '');
  if (!p.startsWith('+')) {
    if (p.startsWith('00')) p = '+' + p.slice(2);
    else if (/^\d{10}$/.test(p)) p = '+91' + p;
    else p = '+' + p;
  }
  return p;
}
