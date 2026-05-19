/**
 * Detect market region from phone number prefix.
 *
 * @param {string} phone - E.164 phone number
 * @returns {'IN'|'UAE'|'UK'|'GLOBAL'}
 */
function detectMarket(phone) {
  if (phone.startsWith("+91")) return "IN";
  if (phone.startsWith("+971")) return "UAE";
  if (phone.startsWith("+44")) return "UK";
  return "GLOBAL";
}

/**
 * Mask middle digits of a phone number for PII protection.
 * Shows first 3 and last 3 characters only.
 *
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone || phone.length <= 6) return phone;
  const first = phone.slice(0, 3);
  const last = phone.slice(-3);
  const masked = "*".repeat(phone.length - 6);
  return `${first}${masked}${last}`;
}

/**
 * Check whether a message contains escalation-trigger keywords.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isEscalationTrigger(text) {
  if (!text) return false;

  const keywords = [
    "injury",
    "medical",
    "pregnancy",
    "medication",
    "pain",
    "dizziness",
    "eating disorder",
    "refund",
    "lawyer",
    "complaint",
    "didn't work",
    "side effect",
  ];

  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Classify a lead's intent from free-text into a program key.
 *
 * @param {string} text
 * @returns {string|null} Program key or null if no match
 */
function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  const rules = [
    { keywords: ["fat loss", "weight", "shred"], program: "6wk_gym" },
    { keywords: ["pcos", "hormonal"], program: "pcos" },
    { keywords: ["40", "menopause", "joints"], program: "40plus" },
    { keywords: ["custom", "12 week", "serious"], program: "12wk" },
    { keywords: ["trial", "zoom", "not sure"], program: "zoom_trial" },
    { keywords: ["home", "no gym", "bodyweight"], program: "6wk_home" },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return rule.program;
    }
  }

  return null;
}

/**
 * Program catalogue mapping program keys to display info.
 */
const programDetails = {
  "6wk_gym": {
    name: "6-Week Burn & Build",
    price: 97,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym",
  },
  "6wk_home": {
    name: "6-Week Home Program",
    price: 97,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home",
  },
  pcos: {
    name: "PCOS Warrior",
    price: 45,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/pcos",
  },
  "40plus": {
    name: "40+ Strong",
    price: 50,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/40plus",
  },
  "12wk": {
    name: "12-Week Flagship",
    price: 200,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/12wk",
  },
  zoom_trial: {
    name: "Zoom Trial Session",
    price: 20,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial",
  },
  zoom_pack: {
    name: "Zoom Session Pack",
    price: 100,
    checkoutUrl: "https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack",
  },
};

module.exports = {
  detectMarket,
  maskPhone,
  isEscalationTrigger,
  classifyIntent,
  programDetails,
};
