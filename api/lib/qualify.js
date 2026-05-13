const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'cut', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'aging', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized', 'transform'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample']
};

function qualifyLead(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return { program, matched: kw };
      }
    }
  }
  return null;
}

function getProgramName(programKey) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[programKey] || programKey;
}

function getProgramPrice(programKey) {
  const prices = {
    '6wk_gym': 97,
    '6wk_home': 97,
    '12wk': 200,
    'pcos': 45,
    '40plus': 50,
    'zoom_trial': 20,
    'zoom_pack': 100
  };
  return prices[programKey] || 0;
}

module.exports = { qualifyLead, getProgramName, getProgramPrice };
