const COUNTRY_CODES = {
  '91': 'IN',
  '971': 'UAE',
  '44': 'UK',
};

function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.length < 6) return '***';
  return cleaned.slice(0, 3) + 'XXX...' + cleaned.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone, COUNTRY_CODES };
