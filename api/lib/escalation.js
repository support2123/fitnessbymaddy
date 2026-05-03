const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'hospital',
  'pregnant', 'pregnancy', 'medication', 'medicine',
  'pain', 'dizziness', 'dizzy', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'purge',
  'refund', 'lawyer', 'complaint', 'legal',
  "didn't work", 'not working', 'side effect', 'side effects',
  'chot', 'dard', 'chakkar', 'ulti',
];

function needsEscalation(text) {
  const lower = (text || '').toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

function classifyEscalation(text) {
  const lower = (text || '').toLowerCase();
  if (/refund|lawyer|legal|complaint/.test(lower)) return 'dispute';
  if (/pregnan|medication|medicine|medical|doctor|hospital/.test(lower)) return 'medical';
  if (/pain|dizz|faint|vomit|chakkar|ulti|dard/.test(lower)) return 'health_concern';
  if (/eating disorder|anorexia|bulimia|purge/.test(lower)) return 'eating_disorder';
  if (/injur|chot/.test(lower)) return 'injury';
  if (/didn't work|not working|side effect/.test(lower)) return 'dissatisfaction';
  return 'unknown';
}

module.exports = { needsEscalation, classifyEscalation, ESCALATION_KEYWORDS };
