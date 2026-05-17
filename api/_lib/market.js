/**
 * Detect market based on phone country code.
 * @param {string} phone - Phone number with country code (e.g. "+919876543210")
 * @returns {'IN'|'UAE'|'UK'|'GLOBAL'}
 */
function detectMarket(phone) {
  const cleaned = String(phone).replace(/\s+/g, "");

  if (cleaned.startsWith("+91")) return "IN";
  if (cleaned.startsWith("+971")) return "UAE";
  if (cleaned.startsWith("+44")) return "UK";

  return "GLOBAL";
}

/**
 * Return preferred language for a market.
 * @param {'IN'|'UAE'|'UK'|'GLOBAL'} market
 * @returns {'hinglish'|'english'}
 */
function getLanguage(market) {
  return market === "IN" ? "hinglish" : "english";
}

module.exports = { detectMarket, getLanguage };
