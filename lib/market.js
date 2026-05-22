function detectMarket(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}

function isHinglish(market) {
  return market === 'IN';
}

function maskPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return '***';
  return '+' + cleaned.slice(0, 2) + 'XXX...' + cleaned.slice(-3);
}

module.exports = { detectMarket, isHinglish, maskPhone };
