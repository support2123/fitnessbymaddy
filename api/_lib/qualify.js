const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'slim', 'lean', 'patla', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', 'full program', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'pehle', 'dekhna'], program: 'zoom_trial', label: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home', price: 97 }
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return entry;
      }
    }
  }
  return null;
}

module.exports = { qualifyLead, PROGRAM_MAP };
