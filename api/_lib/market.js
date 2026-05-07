const MARKET_MAP = {
  '91': { market: 'IN', language: 'Hinglish' },
  '971': { market: 'UAE', language: 'English' },
  '44': { market: 'UK', language: 'English' },
};

function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;

  for (const prefix of ['971', '91', '44']) {
    if (digits.startsWith(prefix)) {
      return MARKET_MAP[prefix];
    }
  }

  return { market: 'GLOBAL', language: 'English' };
}

module.exports = { detectMarket };
