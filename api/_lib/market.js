function detectMarket(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+91')) return 'IN';
  if (cleaned.startsWith('+971')) return 'UAE';
  if (cleaned.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

module.exports = { detectMarket, getLanguage };
