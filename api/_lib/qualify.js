const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'lose weight', 'fat', 'slim', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'older', 'age'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
};

const PROGRAM_DETAILS = {
  '6wk_gym': {
    name: '6-Week Burn & Build',
    price: 97,
    checkout: '6wk-burn-build',
    hinglish: 'Yeh 6-week fat loss program hai — gym ya home, dono options mil jaayenge.',
    english: 'This is our 6-Week Burn & Build — structured for rapid fat loss with gym and home options.',
  },
  '6wk_home': {
    name: '6-Week Home Burn',
    price: 97,
    checkout: '6wk-home',
    hinglish: 'Ghar se bhi kar sakte ho — 6-week home program ready hai.',
    english: 'Our 6-Week Home program — no gym needed, full results.',
  },
  pcos: {
    name: 'PCOS Warrior',
    price: 45,
    checkout: 'pcos-warrior',
    hinglish: 'PCOS ke liye specially designed program hai — hormonal balance + fat loss.',
    english: 'Our PCOS Warrior program — designed for hormonal balance and sustainable fat loss.',
  },
  '40plus': {
    name: '40+ Strong',
    price: 50,
    checkout: '40plus-strong',
    hinglish: '40+ ke liye safe aur effective program — joints friendly, full results.',
    english: 'Our 40+ Strong program — joint-friendly, effective, and designed for your stage of life.',
  },
  '12wk': {
    name: '12-Week Custom Flagship',
    price: 200,
    checkout: '12wk-flagship',
    hinglish: 'Yeh Maddy ka signature program hai — 12 weeks, fully customised sirf tumhare liye.',
    english: "Maddy's signature 12-Week Flagship — fully customised training and nutrition, just for you.",
  },
  zoom_trial: {
    name: '$20 Zoom Trial',
    price: 20,
    checkout: 'zoom-trial',
    hinglish: 'Pehle ek trial try karo — $20 mein Zoom session + basic plan milega.',
    english: 'Start with a $20 Zoom trial — one live session with a basic plan to get started.',
  },
  zoom_pack: {
    name: 'Zoom Pack',
    price: 80,
    checkout: 'zoom-pack',
    hinglish: '4 Zoom sessions ka pack — $80 mein.',
    english: '4-session Zoom pack for $80.',
  },
};

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function getProgramDetails(programKey) {
  return PROGRAM_DETAILS[programKey] || null;
}

module.exports = { qualifyLead, getProgramDetails, PROGRAM_DETAILS };
