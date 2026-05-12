function detectMarket(phone) {
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  if (!phone) return '***';
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.length < 6) return '***';
  return cleaned.slice(0, 4) + 'XXX...' + cleaned.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
