function detectMarket(phone) {
  if (!phone) return { market: 'GLOBAL', lang: 'en' };
  const cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+91') || cleaned.startsWith('91')) {
    return { market: 'IN', lang: 'hi' };
  }
  if (cleaned.startsWith('+971') || cleaned.startsWith('971')) {
    return { market: 'UAE', lang: 'en' };
  }
  if (cleaned.startsWith('+44') || cleaned.startsWith('44')) {
    return { market: 'UK', lang: 'en' };
  }
  return { market: 'GLOBAL', lang: 'en' };
}

module.exports = { detectMarket };
