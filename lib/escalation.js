const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'medical condition', 'pregnancy', 'pregnant', 'medication',
  'pain', 'dizziness', 'dizzy', 'eating disorder', 'anorexia', 'bulimia',
  'vomiting', 'faint', 'chest pain', 'heart'
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/fat\s*loss|weight\s*loss|shred|lean|slim|burn/.test(lower)) {
    return { program: '6wk_gym', name: '6-Week Burn & Build', price: 97 };
  }
  if (/pcos|hormonal|hormone|irregular\s*period/.test(lower)) {
    return { program: 'pcos', name: 'PCOS Warrior', price: 45 };
  }
  if (/40\+|40 plus|menopause|joints|senior|older/.test(lower)) {
    return { program: '40plus', name: '40+ Strong', price: 50 };
  }
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) {
    return { program: '12wk', name: '12-Week Flagship', price: 200 };
  }
  if (/trial|zoom|not sure|try|sample/.test(lower)) {
    return { program: 'zoom_trial', name: '$20 Zoom Trial', price: 20 };
  }
  if (/home|no\s*gym|bodyweight|at\s*home/.test(lower)) {
    return { program: '6wk_home', name: '6-Week Home Program', price: 97 };
  }

  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'].includes(lower);
}

module.exports = { needsEscalation, classifyProgram, isOptOut, ESCALATION_KEYWORDS };
