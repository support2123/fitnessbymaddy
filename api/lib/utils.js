const crypto = require("crypto");

const FORM_SECRET = process.env.FORM_SECRET || "fbm-default-secret";

const PROGRAMS = {
  "6wk_gym": {
    slug: "6wk_gym",
    name: "6-Week Burn & Build (Gym)",
    keywords: ["fat loss", "weight loss", "lose weight", "shred", "lean", "cut", "burn", "weight"],
    duration_weeks: 6,
    price: 97,
  },
  "6wk_home": {
    slug: "6wk_home",
    name: "6-Week Burn & Build (Home)",
    keywords: ["home", "no gym", "bodyweight", "home workout"],
    duration_weeks: 6,
    price: 97,
  },
  "12wk": {
    slug: "12wk",
    name: "12-Week Flagship",
    keywords: ["custom", "12 week", "serious", "flagship", "personalised", "personalized"],
    duration_weeks: 12,
    price: 200,
  },
  pcos: {
    slug: "pcos",
    name: "PCOS Warrior",
    keywords: ["pcos", "hormonal", "hormone", "irregular period"],
    duration_weeks: 6,
    price: 45,
  },
  "40plus": {
    slug: "40plus",
    name: "40+ Strong",
    keywords: ["40", "menopause", "joints", "40+", "over 40", "joint pain"],
    duration_weeks: 6,
    price: 50,
  },
  zoom_trial: {
    slug: "zoom_trial",
    name: "Zoom Trial Session",
    keywords: ["trial", "zoom", "not sure", "try", "test"],
    duration_weeks: 1,
    price: 20,
  },
  zoom_pack: {
    slug: "zoom_pack",
    name: "Zoom Session Pack",
    keywords: ["zoom pack", "session pack", "1-on-1", "one on one", "vip", "live coaching"],
    duration_weeks: 12,
    price: 597,
  },
};

const ESCALATION_KEYWORDS = [
  "refund", "lawyer", "complaint", "didn't work", "side effect",
  "injury", "medical", "pregnancy", "medication", "pain",
  "dizziness", "eating disorder", "disordered eating",
  "hurt", "hospital", "emergency", "suicide", "depressed",
];

function detectMarket(phone) {
  const cleaned = (phone || "").replace(/[^+\d]/g, "");
  if (cleaned.startsWith("+91") || cleaned.startsWith("91")) return "IN";
  if (cleaned.startsWith("+971") || cleaned.startsWith("971")) return "UAE";
  if (cleaned.startsWith("+44") || cleaned.startsWith("44")) return "UK";
  return "GLOBAL";
}

function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const program of Object.values(PROGRAMS)) {
    for (const keyword of program.keywords) {
      if (lower.includes(keyword)) return program;
    }
  }
  return null;
}

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(res, data, status = 200) {
  const cors = corsHeaders();
  for (const [k, v] of Object.entries(cors)) {
    res.setHeader(k, v);
  }
  return res.status(status).json(data);
}

function errorResponse(res, message, status = 500) {
  const cors = corsHeaders();
  for (const [k, v] of Object.entries(cors)) {
    res.setHeader(k, v);
  }
  return res.status(status).json({ error: message });
}

function generateToken(payload) {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  const ts = Date.now().toString(36);
  const hmac = crypto
    .createHmac("sha256", FORM_SECRET)
    .update(`${ts}.${data}`)
    .digest("hex");
  return `${ts}.${Buffer.from(data).toString("base64url")}.${hmac}`;
}

function validateToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [ts, encodedData, signature] = parts;

  const timestamp = parseInt(ts, 36);
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  if (Date.now() - timestamp > maxAge) return null;

  let data;
  try {
    data = Buffer.from(encodedData, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const expected = crypto
    .createHmac("sha256", FORM_SECRET)
    .update(`${ts}.${data}`)
    .digest("hex");

  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  for (const program of Object.values(PROGRAMS)) {
    if (lower.includes(program.slug.replace("_", " ")) || lower.includes(program.slug)) {
      return program;
    }
    for (const keyword of program.keywords) {
      if (lower.includes(keyword)) return program;
    }
  }
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
  validateToken,
  mapProductToProgram,
  PROGRAMS,
};
