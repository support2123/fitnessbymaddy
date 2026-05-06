const PROGRAM_MAP = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 35, duration: 42 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 35, duration: 42 },
  '12wk': { name: '12-Week Flagship Program', price: 200, duration: 84 },
  'pcos': { name: 'PCOS Warrior', price: 45, duration: 42 },
  '40plus': { name: '40+ Strong', price: 50, duration: 42 },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, duration: 7 },
  'zoom_pack': { name: 'Zoom 4-Pack', price: 70, duration: 28 }
};

function matchProgram(message) {
  const lower = message.toLowerCase();

  if (lower.match(/pcos|hormonal|hormone/)) return 'pcos';
  if (lower.match(/40\+?|forty|menopause|joint/)) return '40plus';
  if (lower.match(/custom|12.?week|serious|flagship|transform/)) return '12wk';
  if (lower.match(/trial|zoom|not sure|try/)) return 'zoom_trial';
  if (lower.match(/fat.?loss|weight|shred|lean|burn|cut|slim/)) return '6wk_gym';
  if (lower.match(/home|no.?gym|bodyweight/)) return '6wk_home';

  return null;
}

module.exports = { PROGRAM_MAP, matchProgram };
