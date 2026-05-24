const crypto = require('crypto');

const PROGRAM_KEYWORDS = [
  { keywords: ['fat loss', 'weight', 'shred', 'slim', 'lean'], program: '6wk_gym' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home' },
  { keywords: ['pcos', 'hormonal', 'period', 'irregular'], program: 'pcos' },
  { keywords: ['40', 'menopause', 'joints', 'senior'], program: '40plus' },
  { keywords: ['custom', '12 week', 'serious', 'advanced'], program: '12wk' },
  { keywords: ['trial', 'zoom', 'not sure', 'try'], program: 'zoom_trial' }
];

const ESCALATION_KEYWORDS = [
  'injury', 'medical', 'pregnant', 'medication', 'pain', 'dizzy',
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'eating disorder', 'vomit', 'faint'
];

const PROGRAMS = {
  '6wk_gym': {
    name: '6-Week Gym Transformation',
    price: 4999,
    checkoutPath: '/checkout/6wk-gym',
    duration: '6 weeks'
  },
  '6wk_home': {
    name: '6-Week Home Workout Plan',
    price: 3999,
    checkoutPath: '/checkout/6wk-home',
    duration: '6 weeks'
  },
  pcos: {
    name: 'PCOS Wellness Program',
    price: 5999,
    checkoutPath: '/checkout/pcos',
    duration: '8 weeks'
  },
  '40plus': {
    name: '40+ Fitness Program',
    price: 5499,
    checkoutPath: '/checkout/40plus',
    duration: '8 weeks'
  },
  '12wk': {
    name: '12-Week Advanced Transformation',
    price: 8999,
    checkoutPath: '/checkout/12wk',
    duration: '12 weeks'
  },
  zoom_trial: {
    name: 'Zoom Trial Session',
    price: 499,
    checkoutPath: '/checkout/zoom-trial',
    duration: '1 session'
  }
};

function parseKeywords(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const { keywords, program } of PROGRAM_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }

  return null;
}

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function getProgramDetails(programType) {
  return PROGRAMS[programType] || null;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

function formatIST(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function isOptedOut(status) {
  return status === 'dropped';
}

module.exports = {
  parseKeywords,
  needsEscalation,
  getProgramDetails,
  generateToken,
  formatIST,
  isOptedOut
};
