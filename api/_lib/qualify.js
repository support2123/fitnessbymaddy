const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'compete'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: 20 },
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return {
        program: rule.program,
        label: rule.label,
        price: rule.price,
      };
    }
  }
  return null;
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 30,
  };
  return durations[program] || 42;
}

module.exports = { qualifyLead, getProgramDuration, PROGRAM_RULES };
