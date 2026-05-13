const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build', price: 97 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Shred', price: 77 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'premium', 'flagship', 'personal'], program: '12wk', name: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: 20 },
];

function qualifyLead(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_MAP };
