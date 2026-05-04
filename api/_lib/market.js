function detectMarket(phone) {
  if (!phone) return 'GLOBAL';
  const clean = phone.replace(/[\s\-\(\)]/g, '');
  if (clean.startsWith('+91') || clean.startsWith('91')) return 'IN';
  if (clean.startsWith('+971') || clean.startsWith('971')) return 'UAE';
  if (clean.startsWith('+44') || clean.startsWith('44')) return 'UK';
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
