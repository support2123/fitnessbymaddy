const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home', price: 80 },
];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_RULES };
