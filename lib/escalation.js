const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'condition', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'eating disorder',
  'anorexia', 'bulimia', 'purge', 'refund', 'lawyer', 'complaint',
  "didn't work", 'did not work', 'side effect', 'side-effect',
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out'];

export function checkEscalation(text) {
  const lower = (text || '').toLowerCase();
  const matched = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return matched.length > 0 ? matched : null;
}

export function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

export function detectProgram(text) {
  const lower = (text || '').toLowerCase();
  if (/fat\s*loss|weight|shred/.test(lower)) return { program: '6wk_gym', name: '6-Week Burn & Build' };
  if (/pcos|hormonal/.test(lower)) return { program: 'pcos', name: 'PCOS Warrior' };
  if (/40|menopause|joints/.test(lower)) return { program: '40plus', name: '40+ Strong' };
  if (/custom|12\s*week|serious/.test(lower)) return { program: '12wk', name: '12-Week Flagship' };
  if (/trial|zoom|not sure/.test(lower)) return { program: 'zoom_trial', name: 'Zoom Trial' };
  return null;
}
