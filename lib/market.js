const COUNTRY_CODES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK',
};

export function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  for (const [code, market] of Object.entries(COUNTRY_CODES)) {
    if (cleaned.startsWith(code)) return market;
  }
  return 'GLOBAL';
}

export function isHinglishMarket(market) {
  return market === 'IN';
}

export function maskPhone(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length < 6) return '***';
  return `+${cleaned.slice(0, 2)}XXX...${cleaned.slice(-3)}`;
}
