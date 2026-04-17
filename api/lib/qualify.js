const PROGRAM_KEYWORDS = {
  "6wk_gym": ["fat loss", "weight loss", "weight", "shred", "lean", "burn", "fat"],
  pcos: ["pcos", "hormonal", "hormone", "period", "irregular"],
  "40plus": ["40", "menopause", "joints", "joint", "40+", "over 40"],
  "12wk": ["custom", "12 week", "serious", "transform", "flagship", "premium"],
  zoom_trial: ["trial", "zoom", "not sure", "try", "test"],
};

function qualifyLead(message) {
  const lower = message.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return program;
      }
    }
  }

  return null;
}

function getProgramDetails(programKey) {
  const programs = {
    "6wk_gym": {
      name: "6-Week Burn & Build",
      price: 97,
      currency: "USD",
      description: "6-week gym transformation program",
    },
    "6wk_home": {
      name: "6-Week Home Shred",
      price: 77,
      currency: "USD",
      description: "6-week home workout program",
    },
    "12wk": {
      name: "12-Week Custom Flagship",
      price: 200,
      currency: "USD",
      description: "12-week fully customized coaching",
    },
    pcos: {
      name: "PCOS Warrior",
      price: 45,
      currency: "USD",
      description: "PCOS-specific fitness & nutrition program",
    },
    "40plus": {
      name: "40+ Strong",
      price: 50,
      currency: "USD",
      description: "Age-appropriate strength & mobility",
    },
    zoom_trial: {
      name: "Zoom Trial Session",
      price: 20,
      currency: "USD",
      description: "Single live coaching session",
    },
    zoom_pack: {
      name: "Zoom 4-Pack",
      price: 70,
      currency: "USD",
      description: "4 live coaching sessions",
    },
  };

  return programs[programKey] || null;
}

function getCheckoutUrl(programKey) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${programKey}`;
}

module.exports = { qualifyLead, getProgramDetails, getCheckoutUrl };
