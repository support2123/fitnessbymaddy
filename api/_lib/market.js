const COUNTRY_CODES = {
  '+91': 'IN',
  '+971': 'UAE',
  '+44': 'UK',
};

function detectMarket(phone) {
  const normalized = phone.startsWith('+') ? phone : `+${phone}`;
  for (const [prefix, market] of Object.entries(COUNTRY_CODES)) {
    if (normalized.startsWith(prefix)) return market;
  }
  return 'GLOBAL';
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

module.exports = { detectMarket, getLanguage };
