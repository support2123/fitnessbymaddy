/**
 * Detect the market based on phone number prefix.
 * @param {string} phone - Phone number (with or without +)
 * @returns {'IN'|'UAE'|'UK'|'GLOBAL'}
 */
function detectMarket(phone) {
  const cleaned = phone.replace(/\s+/g, "");

  if (/^\+?91/.test(cleaned)) return "IN";
  if (/^\+?971/.test(cleaned)) return "UAE";
  if (/^\+?44/.test(cleaned)) return "UK";

  return "GLOBAL";
}

/**
 * Get the preferred language for a market.
 * @param {'IN'|'UAE'|'UK'|'GLOBAL'} market
 * @returns {'hinglish'|'english'}
 */
function getLanguage(market) {
  if (market === "IN") return "hinglish";
  return "english";
}

module.exports = { detectMarket, getLanguage };
