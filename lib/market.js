// Detect market + language from phone number country code.
// Hinglish is only used for IN. Everyone else gets English.

export function detectMarket(phone) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+91')  || p.startsWith('91'))  return 'IN';
  if (p.startsWith('+971') || p.startsWith('971')) return 'UAE';
  if (p.startsWith('+44')  || p.startsWith('44'))  return 'UK';
  return 'GLOBAL';
}

export function langFor(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}
