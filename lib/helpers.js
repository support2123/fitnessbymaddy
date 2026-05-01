function detectMarket(phone) {
  const cleaned = phone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+91")) return "IN";
  if (cleaned.startsWith("+971")) return "UAE";
  if (cleaned.startsWith("+44")) return "UK";
  return "GLOBAL";
}

function maskPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return phone;
  const prefix = phone.slice(0, phone.indexOf(digits[0]) + 3);
  const suffix = digits.slice(-3);
  return `${prefix}XXX...${suffix}`;
}

const INTENT_MAP = [
  { keywords: ["fat loss", "weight", "shred"], program: "6wk_gym" },
  { keywords: ["pcos", "hormonal"], program: "pcos" },
  { keywords: ["40", "menopause", "joints"], program: "40plus" },
  { keywords: ["custom", "12 week", "serious"], program: "12wk" },
  { keywords: ["trial", "zoom", "not sure"], program: "zoom_trial" },
];

function classifyIntent(text) {
  const lower = (text || "").toLowerCase();
  for (const { keywords, program } of INTENT_MAP) {
    if (keywords.some((kw) => lower.includes(kw))) return program;
  }
  return null;
}

const ESCALATION_KEYWORDS = [
  "injury",
  "medical condition",
  "pregnancy",
  "medication",
  "pain",
  "dizziness",
  "disordered eating",
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "didn’t work",
  "side effect",
];

function isEscalation(text) {
  const lower = (text || "").toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

const DURATION = {
  "6wk_gym": 6,
  "6wk_home": 6,
  "12wk": 12,
  pcos: 8,
  "40plus": 8,
  zoom_trial: 1,
  zoom_pack: 4,
};

function programDuration(program) {
  return DURATION[program] || null;
}

const PRICES = {
  "6wk_gym": 4900,
  "6wk_home": 3900,
  "12wk": 14900,
  pcos: 7900,
  "40plus": 7900,
  zoom_trial: 500,
  zoom_pack: 3900,
};

function programPrice(program) {
  return PRICES[program] || null;
}

const CHECKOUT_SLUGS = {
  "6wk_gym": "6-week-gym-shred",
  "6wk_home": "6-week-home-shred",
  "12wk": "12-week-custom-coaching",
  pcos: "pcos-hormonal-reset",
  "40plus": "40-plus-strong",
  zoom_trial: "zoom-trial-session",
  zoom_pack: "zoom-4-pack",
};

function checkoutUrl(program) {
  const slug = CHECKOUT_SLUGS[program];
  if (!slug) return null;
  return `https://exly.in/fitnessbymaddy/${slug}`;
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  isEscalation,
  programDuration,
  programPrice,
  checkoutUrl,
};
