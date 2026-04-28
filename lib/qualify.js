const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', name: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home' },
];

function qualifyLead(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { program: entry.program, name: entry.name };
    }
  }
  return null;
}

module.exports = { qualifyLead };
