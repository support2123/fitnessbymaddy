const PROGRAM_MAP = [
  {
    keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose fat', 'slim', 'burn'],
    program: '6wk_gym',
    name: '6-Week Burn & Build (Gym)',
    price: 97,
    checkoutSlug: 'checkout/6wk-burn-build'
  },
  {
    keywords: ['home', 'no gym', 'bodyweight', 'home workout'],
    program: '6wk_home',
    name: '6-Week Burn & Build (Home)',
    price: 79,
    checkoutSlug: 'checkout/6wk-home'
  },
  {
    keywords: ['pcos', 'hormonal', 'hormone', 'irregular period', 'thyroid'],
    program: 'pcos',
    name: 'PCOS Warrior Program',
    price: 45,
    checkoutSlug: 'checkout/pcos-warrior'
  },
  {
    keywords: ['40', '40+', 'menopause', 'joints', 'senior', 'over 40'],
    program: '40plus',
    name: '40+ Strong Program',
    price: 50,
    checkoutSlug: 'checkout/40plus-strong'
  },
  {
    keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'premium', 'personalised', 'personalized'],
    program: '12wk',
    name: '12-Week Flagship Program',
    price: 200,
    checkoutSlug: 'checkout/12wk-flagship'
  },
  {
    keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'],
    program: 'zoom_trial',
    name: '$20 Zoom Trial Session',
    price: 20,
    checkoutSlug: 'checkout/zoom-trial'
  }
];

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const p of PROGRAM_MAP) {
    for (const kw of p.keywords) {
      if (lower.includes(kw)) return p;
    }
  }
  return null;
}

module.exports = { matchProgram, PROGRAM_MAP };
