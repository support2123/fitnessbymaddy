const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizziness', 'dizzy', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'refund', 'lawyer', 'complaint', 'legal',
  'didn\'t work', 'side effect', 'side effects',
  'surgery', 'hospital', 'heart', 'chest pain'
];

function checkEscalation(text) {
  if (!text) return { shouldEscalate: false, triggers: [] };
  const lower = text.toLowerCase();
  const triggers = ESCALATION_KEYWORDS.filter(kw => lower.includes(kw));
  return { shouldEscalate: triggers.length > 0, triggers };
}

function classifyProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+|forty|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|transform/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|bodyweight|no gym|at home/.test(lower)) return '6wk_home';
  return null;
}

const PROGRAM_LABELS = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  '12wk': 200,
  'pcos': 45,
  '40plus': 50,
  'zoom_trial': 20,
  'zoom_pack': 150
};

module.exports = { checkEscalation, classifyProgram, PROGRAM_LABELS, PROGRAM_PRICES };
