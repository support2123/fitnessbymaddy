const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'bulimia', 'anorexia', 'purge',
  'surgery', 'heart', 'diabetes', 'blood pressure'
];

function checkEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched : null;
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'full program', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

module.exports = { checkEscalation, matchProgram, isOptOut, ESCALATION_KEYWORDS };
