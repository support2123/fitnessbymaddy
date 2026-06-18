// lib/utils.js  -  Shared utilities for FitnessByMaddy serverless functions

const crypto = require("crypto");

// -------------------------------------------------------------------
// Escalation keywords  -  any message containing these should be
// routed to Maddy directly instead of an AI reply.
// -------------------------------------------------------------------
const ESCALATION_KEYWORDS = [
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
  "injury",
  "medical",
  "pregnancy",
  "medication",
  "pain",
  "dizziness",
  "eating disorder",
  "not eating",
  "purging",
];

// -------------------------------------------------------------------
// shouldEscalate(text)  -  returns true if the message contains
// any escalation keyword (case-insensitive).
// -------------------------------------------------------------------
function shouldEscalate(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

// -------------------------------------------------------------------
// detectProgram(text)  -  basic keyword matching to identify which
// program a lead is interested in.  Returns a program slug or null.
// -------------------------------------------------------------------
function detectProgram(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // Order matters: more specific patterns first
  if (t.includes("pcos") || t.includes("pcod") || t.includes("hormonal"))
    return "pcos";
  if (t.includes("40") || t.includes("forty") || t.includes("above 40") || t.includes("over 40"))
    return "40plus";
  if (t.includes("zoom trial") || t.includes("trial class") || t.includes("try zoom"))
    return "zoom_trial";
  if (t.includes("zoom pack") || t.includes("zoom monthly") || t.includes("zoom session"))
    return "zoom_pack";
  if (t.includes("12 week") || t.includes("12wk") || t.includes("12-week") || t.includes("3 month"))
    return "12wk";
  if (t.includes("home") || t.includes("no gym") || t.includes("home workout") || t.includes("without gym"))
    return "6wk_home";
  if (t.includes("gym") || t.includes("6 week") || t.includes("6wk") || t.includes("6-week"))
    return "6wk_gym";

  return null;
}

// -------------------------------------------------------------------
// generateToken()  -  returns a random UUID (v4)
// -------------------------------------------------------------------
function generateToken() {
  return crypto.randomUUID();
}

// -------------------------------------------------------------------
// maskPhone(phone)  -  masks a phone number for safe logging
// "+919876543210" => "+91XXX...210"
// -------------------------------------------------------------------
function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone || "";
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-3);
  return `${prefix}XXX...${suffix}`;
}

// -------------------------------------------------------------------
// isHinglish(phone)  -  returns true if the phone is an Indian number.
// Used to decide whether AI replies should mix Hindi + English.
// -------------------------------------------------------------------
function isHinglish(phone) {
  if (!phone) return false;
  return phone.startsWith("+91");
}

module.exports = {
  ESCALATION_KEYWORDS,
  shouldEscalate,
  detectProgram,
  generateToken,
  maskPhone,
  isHinglish,
};
