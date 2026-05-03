const MARKET_PREFIXES = {
  '+91': 'IN',
  '+971': 'UAE',
  '+44': 'UK',
};

function detectMarket(phone) {
  for (const [prefix, market] of Object.entries(MARKET_PREFIXES)) {
    if (phone.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

function isHinglish(phone) {
  return detectMarket(phone) === 'IN';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
