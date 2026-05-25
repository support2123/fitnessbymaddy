/**
 * Detect the market segment from a phone number's country code.
 *
 * @param {string} phone  E.164 formatted phone number (e.g. "+919876543210")
 * @returns {'IN'|'UAE'|'UK'|'GLOBAL'}
 */
function detectMarket(phone) {
  if (!phone) return "GLOBAL";

  const cleaned = phone.replace(/[\s\-()]/g, "");

  if (cleaned.startsWith("+91")) return "IN";
  if (cleaned.startsWith("+971")) return "UAE";
  if (cleaned.startsWith("+44")) return "UK";

  return "GLOBAL";
}

/**
 * Return the preferred language for a market.
 *
 * @param {'IN'|'UAE'|'UK'|'GLOBAL'} market
 * @returns {'hinglish'|'english'}
 */
function getLanguage(market) {
  return market === "IN" ? "hinglish" : "english";
}

module.exports = { detectMarket, getLanguage };
