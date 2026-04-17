const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'full', 'complete', 'personal'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'], program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'bodyweight', 'no gym', 'no equipment'], program: '6wk_home', name: '6-Week Home', price: 79 }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return {
        program: entry.program,
        programName: entry.name,
        price: entry.price
      };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slugs = {
    '6wk_gym': '6-week-burn-and-build',
    '6wk_home': '6-week-home',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    '12wk': '12-week-flagship',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slugs[program] || program}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_MAP };
