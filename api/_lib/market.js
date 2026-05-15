function detectMarket(phone) {
  const p = phone.replace(/\s+/g, '').replace(/^0+/, '');
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
  return phone.substring(0, 3) + 'XXX...' + phone.substring(phone.length - 3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
