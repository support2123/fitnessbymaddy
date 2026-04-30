const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'slim', 'lean', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'knee'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program' },
];

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 80,
};

const CHECKOUT_SLUGS = {
  '6wk_gym': '6wk-shred',
  '6wk_home': '6wk-home',
  '12wk': '12wk-custom',
  'pcos': 'pcos-warrior',
  '40plus': '40plus-strong',
  'zoom_trial': 'zoom-trial',
  'zoom_pack': 'zoom-pack',
};

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of KEYWORD_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return {
          program: entry.program,
          label: entry.label,
          price: PROGRAM_PRICES[entry.program],
          checkoutSlug: CHECKOUT_SLUGS[entry.program],
        };
      }
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const slug = CHECKOUT_SLUGS[program];
  if (!slug) return null;
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${slug}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_PRICES, CHECKOUT_SLUGS };
