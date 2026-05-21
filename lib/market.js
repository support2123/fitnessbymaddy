const MARKET_PREFIXES = [
  { prefix: '+91', market: 'IN' },
  { prefix: '+971', market: 'UAE' },
  { prefix: '+44', market: 'UK' },
];

export function detectMarket(phone) {
  for (const { prefix, market } of MARKET_PREFIXES) {
    if (phone.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

export function isHinglish(market) {
  return market === 'IN';
}

export function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}
