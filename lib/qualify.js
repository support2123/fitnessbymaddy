const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'thyroid'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return { program: entry.program, label: entry.label };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const baseUrl = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-and-build',
    '6wk_home': '6-week-home-burn',
    '12wk': '12-week-flagship',
    pcos: 'pcos-warrior',
    '40plus': '40-plus-strong',
    zoom_trial: 'zoom-trial',
    zoom_pack: 'zoom-pack',
  };
  return `${baseUrl}/${slugs[program] || program}`;
}

module.exports = { qualifyLead, getCheckoutUrl, PROGRAM_MAP };
