const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'patla'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkoutPath: 'sixweek-shred',
  },
  {
    keywords: ['home', 'ghar', 'no gym', 'home workout', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Program',
    price: 75,
    checkoutPath: 'sixweek-home',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
    checkoutPath: 'pcos-warrior',
  },
  {
    keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
    checkoutPath: 'forty-plus',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
    checkoutPath: 'twelve-week',
    starred: true,
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'pehle', 'test', 'dekh'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkoutPath: 'zoom-trial',
  },
];

function matchProgram(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

module.exports = { PROGRAM_MAP, matchProgram };
