const COUNTRY_PREFIXES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK'
};

function detectMarket(phone) {
  const clean = phone.replace(/[^0-9]/g, '');
  for (const [prefix, market] of Object.entries(COUNTRY_PREFIXES)) {
    if (clean.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

module.exports = { detectMarket, isHinglish };
