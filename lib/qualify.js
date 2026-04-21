const KEYWORD_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'senior', 'joint pain'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personali'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program', price: 77 },
];

function qualifyLead(messageText) {
  const lower = messageText.toLowerCase();
  for (const entry of KEYWORD_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry;
    }
  }
  return null;
}

module.exports = { qualifyLead, KEYWORD_MAP };
