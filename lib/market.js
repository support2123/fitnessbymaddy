const COUNTRY_PREFIXES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK'
};

export function detectMarket(phone) {
  const clean = phone.replace(/[^0-9]/g, '');

  for (const [prefix, market] of Object.entries(COUNTRY_PREFIXES)) {
    if (clean.startsWith(prefix)) return market;
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
