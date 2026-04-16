// Detect market from E.164 phone number country code.
// IN -> Hinglish, everything else -> English.
const PREFIX_TO_MARKET = [
  ['+91',  'IN'],
  ['+971', 'UAE'],
  ['+44',  'UK'],
];

export function marketForPhone(phone) {
  if (!phone) return 'GLOBAL';
  const p = String(phone).trim();
  for (const [prefix, market] of PREFIX_TO_MARKET) {
    if (p.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

export function isHinglishMarket(market) {
  return market === 'IN';
}
