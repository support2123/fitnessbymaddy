const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lose', 'slim', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'older', 'age'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session' },
  { keywords: ['home', 'no gym', 'at home', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program' },
];

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const entry of PROGRAM_MAP) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return { program: entry.program, label: entry.label };
      }
    }
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower.includes('opt out') || lower.includes('opt-out');
}

module.exports = { qualifyLead, isOptOut, PROGRAM_MAP };
