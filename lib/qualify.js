const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'burn fat', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'full program', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure']
};

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const FORM_BASE = 'https://fitnessbymaddy.com/intake';

export function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }

  return null;
}

export function getProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[code] || code;
}

export function getProgramPrice(code) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 150
  };
  return prices[code] || 0;
}

export function getCheckoutUrl(leadId) {
  return `${CHECKOUT_BASE}/${leadId}`;
}

export function getIntakeUrl(leadId) {
  return `${FORM_BASE}?lead=${leadId}`;
}
