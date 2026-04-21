const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: 30,
  },
  {
    keywords: ['home', 'home workout', 'no gym', 'bodyweight'],
    program: '6wk_home',
    label: '6-Week Home Program',
    price: 25,
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: 45,
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'mature'],
    program: '40plus',
    label: '40+ Strong',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'flagship', 'full'],
    program: '12wk',
    label: '12-Week Flagship',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'],
    program: 'zoom_trial',
    label: '$20 Zoom Trial',
    price: 20,
  },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return entry;
      }
    }
  }
  return null;
}

function getProgramBySlug(slug) {
  return PROGRAM_MAP.find((p) => p.program === slug) || null;
}

module.exports = { qualifyLead, getProgramBySlug, PROGRAM_MAP };
