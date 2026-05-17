const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'purging',
  'heart', 'chest pain', 'blood pressure', 'diabetes'
];

function needsEscalation(messageText) {
  if (!messageText) return { escalate: false };
  const lower = messageText.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { escalate: true, trigger: keyword };
    }
  }

  return { escalate: false };
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'lean', 'fat', 'lose weight'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample']
};

function detectProgram(messageText) {
  if (!messageText) return null;
  const lower = messageText.toLowerCase();

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }

  return null;
}

module.exports = { needsEscalation, isOptOut, detectProgram, ESCALATION_KEYWORDS };
