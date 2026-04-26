const crypto = require("crypto");

const COUNTRY_CODES = [
  { prefix: "+91", market: "IN" },
  { prefix: "+971", market: "UAE" },
  { prefix: "+44", market: "UK" },
];

function detectMarket(phone) {
  const cleaned = (phone || "").replace(/\s/g, "");
  for (const { prefix, market } of COUNTRY_CODES) {
    if (cleaned.startsWith(prefix)) return market;
  }
  return "GLOBAL";
}

function maskPhone(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const first3 = digits.slice(0, 3);
  const last3 = digits.slice(-3);
  return `+${first3}XXX...${last3}`;
}

const PROGRAM_PATTERNS = [
  { keywords: ["fat loss", "weight", "shred"], program: "6wk_gym" },
  { keywords: ["pcos", "hormonal"], program: "pcos" },
  { keywords: ["40", "menopause", "joints"], program: "40plus" },
  { keywords: ["custom", "12 week", "serious"], program: "12wk" },
  { keywords: ["trial", "zoom", "not sure"], program: "zoom_trial" },
];

function parseKeywords(text) {
  const lower = (text || "").toLowerCase();
  for (const { keywords, program } of PROGRAM_PATTERNS) {
    if (keywords.some((kw) => lower.includes(kw))) return program;
  }
  return null;
}

const ESCALATION_TRIGGERS = [
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
  "side effect",
];

function checkEscalation(text) {
  const lower = (text || "").toLowerCase();
  for (const trigger of ESCALATION_TRIGGERS) {
    if (lower.includes(trigger)) {
      return { shouldEscalate: true, reason: trigger };
    }
  }
  return { shouldEscalate: false, reason: "" };
}

function isOptOut(text) {
  const lower = (text || "").toLowerCase();
  return lower.includes("stop") || lower.includes("unsubscribe");
}

function generateToken() {
  return crypto.randomUUID();
}

module.exports = {
  detectMarket,
  maskPhone,
  parseKeywords,
  checkEscalation,
  isOptOut,
  generateToken,
};
