const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkoutPath: 'six-week-burn',
  },
  {
    keywords: ['home', 'no gym', 'home workout', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 79,
    checkoutPath: 'six-week-home',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkoutPath: 'pcos-warrior',
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkoutPath: 'forty-plus-strong',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'competition'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkoutPath: 'twelve-week-flagship',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial',
    price: 20,
    checkoutPath: 'zoom-trial',
  },
];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

module.exports = { PROGRAM_MAP, matchProgram };
