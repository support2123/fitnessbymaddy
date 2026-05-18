const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'transform', 'full program'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial' },
];

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  'pcos': 45,
  '40plus': 50,
  '12wk': 200,
  'zoom_trial': 20,
  'zoom_pack': 150,
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  'pcos': 42,
  '40plus': 42,
  '12wk': 84,
  'zoom_trial': 7,
  'zoom_pack': 28,
};

function classifyLead(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return { program: rule.program, label: rule.label };
      }
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

module.exports = { classifyLead, PROGRAM_PRICES, PROGRAM_DURATIONS, getCheckoutUrl };
