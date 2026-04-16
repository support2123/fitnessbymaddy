// Intent router for incoming WhatsApp text.
const RULES = [
  { match: /\b(stop|unsubscribe|opt[\s-]?out)\b/i, intent: 'opt_out' },
  { match: /\b(refund|lawyer|complaint|side effect)\b/i, intent: 'escalate' },
  { match: /\b(injur(y|ed)|pain|dizzy|pregnan|medication|medical)\b/i, intent: 'escalate' },
  { match: /\b(pcos|hormonal)\b/i, program: 'pcos' },
  { match: /\b(40|menopause|joints?)\b/i, program: '40plus' },
  { match: /\b(custom|12[-\s]?week|serious|flagship)\b/i, program: '12wk' },
  { match: /\b(trial|zoom|not\s?sure|maybe)\b/i, program: 'zoom_trial' },
  { match: /\b(fat\s?loss|weight\s?loss|shred|lose\s?weight|burn)\b/i, program: '6wk_gym' },
  { match: /\b(home|no\s?gym|bodyweight)\b/i, program: '6wk_home' },
];

export function routeMessage(text) {
  if (!text) return { intent: 'unknown' };
  for (const rule of RULES) {
    if (rule.match.test(text)) {
      return { intent: rule.intent || 'qualify', program: rule.program || null };
    }
  }
  return { intent: 'unknown' };
}

export function templateForProgram(program) {
  switch (program) {
    case 'pcos':       return 'qualify_pcos';
    case '40plus':     return 'qualify_40plus';
    case '12wk':       return 'qualify_12wk';
    case 'zoom_trial': return 'qualify_trial';
    case '6wk_gym':
    case '6wk_home':   return 'qualify_6wk';
    default:           return 'qualify_6wk';
  }
}
