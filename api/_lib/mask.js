function maskPhone(phone) {
  if (!phone) return '***';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 6) return '***';
  return '+' + cleaned.slice(0, 2) + 'XXX...' + cleaned.slice(-3);
}

module.exports = { maskPhone };
