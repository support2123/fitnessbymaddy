// Phone country code → market + language
export function marketFromPhone(phone) {
  const p = String(phone || '').replace(/\s+/g, '');
  if (p.startsWith('+91')) return { market: 'IN', lang: 'hinglish' };
  if (p.startsWith('+971')) return { market: 'UAE', lang: 'en' };
  if (p.startsWith('+44')) return { market: 'UK', lang: 'en' };
  return { market: 'GLOBAL', lang: 'en' };
}
