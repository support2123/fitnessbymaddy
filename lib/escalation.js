const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'pregnant', 'pregnancy',
  'medication', 'medicine', 'pain', 'dizzy', 'dizziness', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'legal', 'court', 'scam'
];

function needsEscalation(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

function classifyProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/fat\s*loss|weight|shred|lean|slim|tone/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40|forty|menopause|joint|knee|back pain|senior/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test|unsure/.test(lower)) return 'zoom_trial';
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) return '6wk_home';
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { needsEscalation, classifyProgram, isOptOut, ESCALATION_KEYWORDS };
