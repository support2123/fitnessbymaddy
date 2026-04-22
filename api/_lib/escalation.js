const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'binge', 'purge', 'refund', 'lawyer',
  'complaint', "didn't work", 'side effect', 'chest pain', 'faint',
  'surgery', 'doctor said',
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function isOptOut(text) {
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyProgram(text) {
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean/.test(lower)) return '6wk_gym';
  if (/home|bodyweight|no\s*gym|no\s*equipment/.test(lower)) return '6wk_home';
  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+|forty|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not\s*sure|try|test/.test(lower)) return 'zoom_trial';
  return null;
}

module.exports = { needsEscalation, isOptOut, classifyProgram, ESCALATION_KEYWORDS };
