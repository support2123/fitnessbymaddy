function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  const cleaned = phone.replace(/\D/g, '');
  return '+' + cleaned.substring(0, 2) + 'XXX...' + cleaned.slice(-3);
}

module.exports = { maskPhone };
