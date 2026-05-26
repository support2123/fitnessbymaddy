function detectMarket(phone) {
  const p = phone.replace(/\D/g, '');
  if (p.startsWith('91')) return 'IN';
  if (p.startsWith('971')) return 'UAE';
  if (p.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, 4) + 'XXX...' + phone.slice(-3);
}

function isHinglishMarket(market) {
  return market === 'IN';
}

module.exports = { detectMarket, maskPhone, isHinglishMarket };
