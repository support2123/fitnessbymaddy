const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Shred', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(messageText) {
  const lower = (messageText || '').toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return {
        program: rule.program,
        label: rule.label,
        price: rule.price
      };
    }
  }

  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

module.exports = { qualifyLead, isOptOut, PROGRAM_RULES };
