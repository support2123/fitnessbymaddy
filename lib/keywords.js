const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose weight', 'weight loss', 'slim'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
  },
  {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', '50', 'older'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
  },
  {
    keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
  },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_MAP };
