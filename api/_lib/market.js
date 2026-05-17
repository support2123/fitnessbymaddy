function detectMarket(phone) {
  const p = phone.replace(/[^0-9+]/g, '');
  if (p.startsWith('+91') || p.startsWith('91')) return 'IN';
  if (p.startsWith('+971') || p.startsWith('971')) return 'UAE';
  if (p.startsWith('+44') || p.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
