function maskPhone(phone) {
  const p = String(phone).replace(/[^0-9+]/g, '');
  if (p.length < 6) return '***';
  return p.slice(0, 3) + 'XXX...' + p.slice(-3);
}

module.exports = { maskPhone };
