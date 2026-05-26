const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizziness', 'dizzy', 'faint', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'not eating'
];

function needsEscalation(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/(fat\s*loss|weight|shred|lean|cut)/.test(lower)) return '6wk_gym';
  if (/(pcos|hormonal|hormone|pcod)/.test(lower)) return 'pcos';
  if (/(40\+?|forty|menopause|joint|joints|older)/.test(lower)) return '40plus';
  if (/(custom|12\s*week|serious|flagship|transform)/.test(lower)) return '12wk';
  if (/(trial|zoom|not sure|try|test)/.test(lower)) return 'zoom_trial';
  if (/(home|no gym|bodyweight|at home)/.test(lower)) return '6wk_home';

  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = { needsEscalation, detectProgram, isOptOut, ESCALATION_KEYWORDS };
