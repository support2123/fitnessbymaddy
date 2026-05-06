const COUNTRY_CODES = [
  { prefix: '91', market: 'IN' },
  { prefix: '971', market: 'UAE' },
  { prefix: '44', market: 'UK' },
];

function detectMarket(phone) {
  const cleaned = phone.replace(/^\+/, '');
  for (const { prefix, market } of COUNTRY_CODES) {
    if (cleaned.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

module.exports = { detectMarket, isHinglish };
