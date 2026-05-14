function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-3);
  return `+${prefix}XXX...${suffix}`;
}

module.exports = { maskPhone };
