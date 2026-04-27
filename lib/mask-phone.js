function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  const clean = phone.replace(/[^0-9+]/g, '');
  return clean.substring(0, 4) + 'XXX...' + clean.slice(-3);
}

module.exports = { maskPhone };
