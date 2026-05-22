const PROGRAM_ROUTES = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'slim', 'patla'],
    program: '6wk_gym',
    label: '6-Week Burn & Build',
    price: '$97'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
    program: 'pcos',
    label: 'PCOS Warrior',
    price: '$45'
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior', 'age'],
    program: '40plus',
    label: '40+ Strong',
    price: '$50'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'flagship', 'full program'],
    program: '12wk',
    label: '12-Week Flagship',
    price: '$200'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle', 'dekhna'],
    program: 'zoom_trial',
    label: 'Zoom Trial Session',
    price: '$20'
  }
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_ROUTES };
