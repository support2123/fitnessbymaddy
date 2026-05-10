/**
 * Shared utilities for FitnessByMaddy API.
 */

const PROGRAMS = {
  shred: {
    slug: "shred",
    keywords: ["shred", "fat loss", "weight loss", "lose weight", "lean", "cut", "cutting", "slim"],
    duration_weeks: 12,
    checkout_url: process.env.CHECKOUT_URL_SHRED || "https://fitnessbymaddy.exly.app/shred",
  },
  vip: {
    slug: "vip",
    keywords: ["vip", "premium", "1 on 1", "one on one", "personal", "custom", "personalised", "personalized"],
    duration_weeks: 12,
    checkout_url: process.env.CHECKOUT_URL_VIP || "https://fitnessbymaddy.exly.app/vip",
  },
  group: {
    slug: "group",
    keywords: ["group", "batch", "community", "affordable", "budget"],
    duration_weeks: 8,
    checkout_url: process.env.CHECKOUT_URL_GROUP || "https://fitnessbymaddy.exly.app/group",
  },
};

const ESCALATION_KEYWORDS = [
  "refund", "cancel", "complaint", "angry", "scam", "fraud", "legal",
  "lawyer", "police", "hurt", "injury", "injured", "pain", "doctor",
  "hospital", "emergency", "medical", "suicide", "die", "depressed",
];

/**
 * Detect market (country) from phone number prefix.
 * Returns "IN", "UAE", "UK", or "OTHER".
 */
function detectMarket(phone) {
  const cleaned = (phone || "").replace(/[^+\d]/g, "");
  if (cleaned.startsWith("+91") || cleaned.startsWith("91")) return "IN";
  if (cleaned.startsWith("+971") || cleaned.startsWith("971")) return "UAE";
  if (cleaned.startsWith("+44") || cleaned.startsWith("44")) return "UK";
  return "OTHER";
}

/**
 * Detect which program the user is interested in based on their message.
 * Returns the program object or null if no match.
 */
function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const [, program] of Object.entries(PROGRAMS)) {
    for (const keyword of program.keywords) {
      if (lower.includes(keyword)) {
        return program;
      }
    }
  }
  return null;
}

/**
 * Check if a message needs escalation to Maddy.
 */
function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Standard CORS headers for browser-facing endpoints.
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Send a JSON success response.
 */
function jsonResponse(res, data, status = 200) {
  const cors = corsHeaders();
  for (const [k, v] of Object.entries(cors)) {
    res.setHeader(k, v);
  }
  return res.status(status).json(data);
}

/**
 * Send a JSON error response.
 */
function errorResponse(res, message, status = 500) {
  const cors = corsHeaders();
  for (const [k, v] of Object.entries(cors)) {
    res.setHeader(k, v);
  }
  return res.status(status).json({ error: message });
}

/**
 * Generate a simple random token (hex string).
 */
function generateToken(length = 32) {
  const chars = "abcdef0123456789";
  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

/**
 * Map an Exly product name to an internal program slug.
 */
function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes("shred")) return PROGRAMS.shred;
  if (lower.includes("vip") || lower.includes("premium") || lower.includes("1-on-1")) return PROGRAMS.vip;
  if (lower.includes("group") || lower.includes("batch")) return PROGRAMS.group;
  return null;
}

module.exports = {
  detectMarket,
  detectProgram,
  needsEscalation,
  corsHeaders,
  jsonResponse,
  errorResponse,
  generateToken,
  mapProductToProgram,
  PROGRAMS,
};
