const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'home workout', 'no gym', 'ghar pe'], program: '6wk_home', label: '6-Week Home Burn', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', label: '12-Week Custom Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home-burn',
    '12wk': '12-week-custom',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack',
  };
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slugs[program] || program}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_MAP };
