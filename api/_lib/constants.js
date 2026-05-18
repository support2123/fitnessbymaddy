const PROGRAMS = {
  '6wk_gym': {
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    duration: 6,
    keywords: ['fat loss', 'weight', 'shred', 'burn', 'gym', 'lean']
  },
  '6wk_home': {
    name: '6-Week Burn & Build (Home)',
    price: 97,
    duration: 6,
    keywords: ['home', 'home workout', 'no gym']
  },
  '12wk': {
    name: '12-Week Custom Training',
    price: 200,
    duration: 12,
    keywords: ['custom', '12 week', 'serious', 'transform', 'flagship']
  },
  pcos: {
    name: 'PCOS Warrior Program',
    price: 45,
    duration: 8,
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular']
  },
  '40plus': {
    name: '40+ Strong Program',
    price: 50,
    duration: 8,
    keywords: ['40', 'menopause', 'joints', 'senior', 'over 40']
  },
  zoom_trial: {
    name: 'Zoom Trial Session',
    price: 20,
    duration: 1,
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test']
  },
  zoom_pack: {
    name: 'Zoom 4-Pack',
    price: 70,
    duration: 4,
    keywords: ['zoom pack', '4 sessions', 'live']
  }
};

function matchProgram(text) {
  const lower = text.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const [key, program] of Object.entries(PROGRAMS)) {
    for (const keyword of program.keywords) {
      if (lower.includes(keyword) && keyword.length > bestScore) {
        bestMatch = key;
        bestScore = keyword.length;
      }
    }
  }
  return bestMatch;
}

const STATUS = {
  LEAD: { NEW: 'new', QUALIFIED: 'qualified', CONVERTED: 'converted', DROPPED: 'dropped' },
  CLIENT: { ACTIVE: 'active', PAUSED: 'paused', COMPLETED: 'completed', REFUNDED: 'refunded' }
};

module.exports = { PROGRAMS, matchProgram, STATUS };
