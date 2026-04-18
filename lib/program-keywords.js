const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'patla', 'vajan'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkout: '6wk-burn-build',
  },
  {
    keywords: ['pcos', 'pcod', 'hormonal', 'hormone', 'period', 'irregular'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkout: 'pcos-warrior',
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'mature'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkout: '40plus-strong',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'dedicated', 'full program', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkout: '12wk-flagship',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'dekh', 'pehle'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkout: 'zoom-trial',
  },
];

function matchProgram(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_MAP };
