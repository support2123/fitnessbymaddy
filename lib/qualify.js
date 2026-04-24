const PROGRAM_RULES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'aging', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home', 'home workout'], program: '6wk_home', label: '6-Week Home' }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const rule of PROGRAM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return { program: rule.program, label: rule.label };
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  const base = 'https://fitnessbymaddyy.exlyapp.com/checkout';
  const slugs = {
    '6wk_gym': '6-week-burn-build',
    '6wk_home': '6-week-home',
    '12wk': '12-week-custom',
    'pcos': 'pcos-warrior',
    '40plus': '40-plus-strong',
    'zoom_trial': 'zoom-trial',
    'zoom_pack': 'zoom-pack'
  };
  return `${base}/${slugs[program] || program}`;
}

function getProgramReply(qualification, market, leadId) {
  const isIN = market === 'IN';
  const checkout = getCheckoutUrl(qualification.program);
  const intake = `https://fitnessbymaddy.com/intake?lead=${leadId}`;

  if (isIN) {
    return `${qualification.label} program perfect hoga tere liye!\n\nYe raha checkout link:\n${checkout}\n\nAur ye intake form bhar de taaki Maddy tera plan customise kar sake:\n${intake}\n\nKoi doubt ho toh pooch!`;
  }

  return `The ${qualification.label} program would be perfect for you!\n\nCheckout here:\n${checkout}\n\nPlease also fill this intake form so Maddy can customise your plan:\n${intake}\n\nFeel free to ask any questions!`;
}

module.exports = { qualifyLead, getCheckoutUrl, getProgramReply };
