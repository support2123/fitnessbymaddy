function detectMarket(phone) {
  if (phone.startsWith('+91') || phone.startsWith('91')) return 'IN';
  if (phone.startsWith('+971') || phone.startsWith('971')) return 'UAE';
  if (phone.startsWith('+44') || phone.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  const cc = phone.startsWith('+') ? phone.slice(0, phone.indexOf('', 2)) : '';
  return phone.slice(0, 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
