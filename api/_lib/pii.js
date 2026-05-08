function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, phone.indexOf('0') > 0 ? 4 : 3) + 'XXX...' + phone.slice(-3);
}

module.exports = { maskPhone };
