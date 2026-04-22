const COUNTRY_PREFIXES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK',
};

function detectMarket(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  for (const [prefix, market] of Object.entries(COUNTRY_PREFIXES)) {
    if (digits.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 6) return '***';
  return '+' + digits.slice(0, 3) + 'XXX...' + digits.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
