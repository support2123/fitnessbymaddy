function detectMarket(phone) {
  if (!phone) return "GLOBAL";
  const cleaned = phone.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+91") || cleaned.startsWith("91")) return "IN";
  if (cleaned.startsWith("+971") || cleaned.startsWith("971")) return "UAE";
  if (cleaned.startsWith("+44") || cleaned.startsWith("44")) return "UK";
  return "GLOBAL";
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "***";
  return phone.slice(0, 4) + "XXX..." + phone.slice(-3);
}

function classifyIntent(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  if (/\b(stop|unsubscribe|opt.?out)\b/.test(lower)) return "OPT_OUT";
  if (/\b(fat.?loss|weight|shred|lean|cut)\b/.test(lower)) return "6wk_gym";
  if (/\b(pcos|hormonal|period|irregular)\b/.test(lower)) return "pcos";
  if (/\b(40|forty|menopause|joint|knee)\b/.test(lower)) return "40plus";
  if (/\b(custom|12.?week|serious|flagship|transform)\b/.test(lower)) return "12wk";
  if (/\b(trial|zoom|not sure|try|test)\b/.test(lower)) return "zoom_trial";
  if (/\b(home|no.?gym|bodyweight|at.?home)\b/.test(lower)) return "6wk_home";
  return null;
}

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const triggers = [
    "injury", "medical", "pregnant", "pregnancy", "medication",
    "pain", "dizzy", "dizziness", "eating disorder", "purge", "binge",
    "refund", "lawyer", "complaint", "didn't work", "side effect",
    "heart", "surgery", "doctor said", "hospital",
  ];
  return triggers.some((t) => lower.includes(t));
}

const PROGRAM_NAMES = {
  "6wk_gym": "6-Week Burn & Build (Gym)",
  "6wk_home": "6-Week Burn & Build (Home)",
  "12wk": "12-Week Custom Training",
  pcos: "PCOS Warrior Program",
  "40plus": "40+ Strong Program",
  zoom_trial: "$20 Zoom Trial",
  zoom_pack: "Zoom Session Pack",
};

const PROGRAM_PRICES = {
  "6wk_gym": 97,
  "6wk_home": 97,
  "12wk": 297,
  pcos: 45,
  "40plus": 50,
  zoom_trial: 20,
  zoom_pack: 200,
};

const PROGRAM_DURATIONS_WEEKS = {
  "6wk_gym": 6,
  "6wk_home": 6,
  "12wk": 12,
  pcos: 8,
  "40plus": 8,
  zoom_trial: 1,
  zoom_pack: 12,
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = {
  detectMarket,
  maskPhone,
  classifyIntent,
  needsEscalation,
  cors,
  PROGRAM_NAMES,
  PROGRAM_PRICES,
  PROGRAM_DURATIONS_WEEKS,
};
