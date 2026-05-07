const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'slim', 'lean', 'lose fat'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'thyroid'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior', 'older'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'compete', 'competition', 'bulk', 'muscle gain'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Burn' }
];

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 150
};

function qualifyLead(messageBody) {
  if (!messageBody) return null;
  const lower = messageBody.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) {
        return { program: route.program, label: route.label };
      }
    }
  }
  return null;
}

function getCheckoutUrl(program) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
}

function getIntakeUrl(leadId) {
  return `https://fitnessbymaddy.com/intake?lead=${leadId}`;
}

module.exports = { qualifyLead, getCheckoutUrl, getIntakeUrl, PROGRAM_PRICES, PROGRAM_ROUTES };
