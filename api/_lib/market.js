function detectMarket(phone) {
  const p = String(phone).replace(/[^0-9+]/g, '');
  if (p.startsWith('+91') || p.startsWith('91')) return 'IN';
  if (p.startsWith('+971') || p.startsWith('971')) return 'UAE';
  if (p.startsWith('+44') || p.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

module.exports = { detectMarket, isHinglish };
