const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'burn': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'flagship': '12wk',
  'premium': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_DETAILS = {
  '6wk_gym': {
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    checkout_slug: '6-week-burn-build',
    duration_weeks: 6
  },
  '6wk_home': {
    name: '6-Week Burn & Build (Home)',
    price: 97,
    checkout_slug: '6-week-home',
    duration_weeks: 6
  },
  '12wk': {
    name: '12-Week Flagship Program',
    price: 200,
    checkout_slug: '12-week-flagship',
    duration_weeks: 12
  },
  pcos: {
    name: 'PCOS Warrior Program',
    price: 45,
    checkout_slug: 'pcos-warrior',
    duration_weeks: 8
  },
  '40plus': {
    name: '40+ Strong Program',
    price: 50,
    checkout_slug: '40plus-strong',
    duration_weeks: 8
  },
  zoom_trial: {
    name: 'Zoom Trial Session',
    price: 20,
    checkout_slug: 'zoom-trial',
    duration_weeks: 1
  },
  zoom_pack: {
    name: 'Zoom Session Pack',
    price: 150,
    checkout_slug: 'zoom-pack',
    duration_weeks: 8
  }
};

function detectProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function getProgramDetails(programKey) {
  return PROGRAM_DETAILS[programKey] || null;
}

module.exports = { detectProgram, getProgramDetails, PROGRAM_MAP, PROGRAM_DETAILS };
