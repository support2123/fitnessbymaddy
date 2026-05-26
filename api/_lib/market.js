/**
 * Detect market based on phone country code.
 * @param {string} phone - Phone number with country code (e.g., +919876543210)
 * @returns {string} Market code: 'IN', 'UAE', 'UK', or 'GLOBAL'
 */
function detectMarket(phone) {
  if (!phone) return 'GLOBAL';

  const cleaned = phone.replace(/\s+/g, '');

  if (cleaned.startsWith('+91')) return 'IN';
  if (cleaned.startsWith('+971')) return 'UAE';
  if (cleaned.startsWith('+44')) return 'UK';

  return 'GLOBAL';
}

/**
 * Get preferred language based on market.
 * @param {string} market - Market code from detectMarket()
 * @returns {string} 'hinglish' for IN, 'english' for all others
 */
function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

module.exports = { detectMarket, getLanguage };
