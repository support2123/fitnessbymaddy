const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'cut', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'over 40', 'senior'],
  '12wk': ['custom', '12 week', 'serious', 'transform', 'full program', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo']
};

const PROGRAM_DETAILS = {
  '6wk_gym':     { name: '6 Week Burn & Build', price: 97,  slug: '6wk-burn-build' },
  '6wk_home':    { name: '6 Week Home Shred',   price: 97,  slug: '6wk-home-shred' },
  'pcos':        { name: 'PCOS Warrior',         price: 45,  slug: 'pcos-warrior' },
  '40plus':      { name: '40+ Strong',           price: 50,  slug: '40plus-strong' },
  '12wk':        { name: '12-Week Flagship',     price: 200, slug: '12wk-flagship' },
  'zoom_trial':  { name: 'Zoom Trial Session',   price: 20,  slug: 'zoom-trial' },
  'zoom_pack':   { name: 'Zoom Session Pack',    price: 150, slug: 'zoom-pack' }
};

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

function getProgramDetails(programKey) {
  return PROGRAM_DETAILS[programKey] || null;
}

module.exports = { qualifyLead, getProgramDetails, PROGRAM_DETAILS };
