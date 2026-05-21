const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'slim', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'twelve', 'serious', 'advanced', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure', 'confused'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar', 'home workout'], program: '6wk_home', label: '6-Week Home Program' }
];

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return { program: rule.program, label: rule.label };
      }
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const base = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const map = {
    '6wk_gym': `${base}/6wk-burn-build`,
    '6wk_home': `${base}/6wk-home`,
    '12wk': `${base}/12wk-flagship`,
    'pcos': `${base}/pcos-warrior`,
    '40plus': `${base}/40plus-strong`,
    'zoom_trial': `${base}/zoom-trial`,
    'zoom_pack': `${base}/zoom-pack`
  };
  return map[program] || base;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_RULES };
