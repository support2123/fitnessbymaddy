function detectMarket(phone) {
  const p = String(phone).replace(/[^0-9]/g, '');
  if (p.startsWith('91')) return 'IN';
  if (p.startsWith('971')) return 'UAE';
  if (p.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  const p = String(phone);
  if (p.length < 6) return '***';
  return p.slice(0, 3) + 'XXX...' + p.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
