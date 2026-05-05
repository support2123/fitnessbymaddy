function detectMarket(phone) {
  if (phone.startsWith("+91")) return "IN";
  if (phone.startsWith("+971")) return "UAE";
  if (phone.startsWith("+44")) return "UK";
  return "GLOBAL";
}

function getLanguage(market) {
  return market === "IN" ? "hinglish" : "english";
}

module.exports = { detectMarket, getLanguage };
