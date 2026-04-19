function maskPhone(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 6) return '***';
  return '+' + digits.slice(0, 2) + 'XXX...' + digits.slice(-3);
}

module.exports = { maskPhone };
