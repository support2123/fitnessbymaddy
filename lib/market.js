/**
 * Country code → market prefix mapping.
 */
const MARKET_PREFIXES = {
  '+91': 'IN',
  '+971': 'UAE',
  '+44': 'UK',
};

/**
 * Detect the market for a phone number based on its country code.
 *
 * @param {string} phone - Full international phone number (e.g. "+917082478374")
 * @returns {"IN" | "UAE" | "UK" | "GLOBAL"}
 */
function detectMarket(phone) {
  if (!phone) return 'GLOBAL';

  // Check longest prefixes first to avoid false matches
  // (e.g. +971 must be checked before +97 if that ever existed)
  const sorted = Object.keys(MARKET_PREFIXES).sort(
    (a, b) => b.length - a.length
  );

  for (const prefix of sorted) {
    if (phone.startsWith(prefix)) {
      return MARKET_PREFIXES[prefix];
    }
  }

  return 'GLOBAL';
}

/**
 * Get the preferred language for a market.
 * Indian leads get Hinglish; everyone else gets English.
 *
 * @param {"IN" | "UAE" | "UK" | "GLOBAL"} market
 * @returns {"hinglish" | "english"}
 */
function getLanguage(market) {
  return market === 'IN' ? 'hinglish' : 'english';
}

module.exports = { detectMarket, getLanguage };
