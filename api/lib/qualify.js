const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar pe'], program: '6wk_home', label: '6-Week Home Program' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'knee', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'pehle'], program: 'zoom_trial', label: 'Zoom Trial' },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of KEYWORD_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return { program: entry.program, label: entry.label };
      }
    }
  }
  return null;
}

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

function getCheckoutUrl(program) {
  return CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
}

module.exports = { qualifyLead, getCheckoutUrl };
