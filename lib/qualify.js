const ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'back pain'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program' }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const route of ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const map = {
    '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
    '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
    '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
    'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
    '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
    'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
  };
  return map[program] || map['zoom_trial'];
}

module.exports = { qualifyLead, getCheckoutUrl, ROUTES };
