const MARKET_PREFIXES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK',
};

export function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  for (const [prefix, market] of Object.entries(MARKET_PREFIXES)) {
    if (cleaned.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

export function isHinglish(phone) {
  return detectMarket(phone) === 'IN';
}
