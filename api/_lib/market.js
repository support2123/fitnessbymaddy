function detectMarket(phone) {
  if (phone.startsWith('+91')) return 'IN';
  if (phone.startsWith('+971')) return 'UAE';
  if (phone.startsWith('+44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

module.exports = { detectMarket, isHinglish };
