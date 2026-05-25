const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'],
    program: '6wk_gym',
    name: '6-Week Burn & Build',
    price: 97,
    checkoutPath: 'checkout/6wk-burn',
  },
  {
    keywords: ['home', 'no gym', 'home workout', 'bodyweight'],
    program: '6wk_home',
    name: '6-Week Home Shred',
    price: 67,
    checkoutPath: 'checkout/6wk-home',
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior',
    price: 45,
    checkoutPath: 'checkout/pcos',
  },
  {
    keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', '50'],
    program: '40plus',
    name: '40+ Strong',
    price: 50,
    checkoutPath: 'checkout/40plus',
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'compete', 'flagship'],
    program: '12wk',
    name: '12-Week Flagship',
    price: 200,
    checkoutPath: 'checkout/12wk',
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    name: 'Zoom Trial Session',
    price: 20,
    checkoutPath: 'checkout/zoom-trial',
  },
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

function isOptOut(messageBody) {
  if (!messageBody) return false;
  const lower = messageBody.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

module.exports = { qualifyLead, isOptOut, PROGRAM_MAP };
