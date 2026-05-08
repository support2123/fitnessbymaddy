const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'lose fat', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97, checkoutSlug: '6-week-shred' },
  { keywords: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', name: '6-Week Home Program', price: 97, checkoutSlug: '6-week-home' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', name: 'PCOS Warrior', price: 45, checkoutSlug: 'pcos-warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'over 40', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: 50, checkoutSlug: '40-plus-strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personali', 'personalise', 'bespoke'], program: '12wk', name: '12-Week Custom Training', price: 200, checkoutSlug: '12-week-custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'confused', 'unsure'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20, checkoutSlug: 'zoom-trial' }
];

function qualifyLead(message) {
  const lower = (message || '').toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

function getCheckoutUrl(checkoutSlug) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake.html?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_MAP };
