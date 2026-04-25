const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'lose fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'home workout', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', '40+', '40 plus'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized', 'full program'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_RULES };
