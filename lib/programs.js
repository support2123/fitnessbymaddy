const PROGRAMS = {
  '6wk_gym': {
    name: '6 Week Burn & Build (Gym)',
    price: 97,
    duration_weeks: 6,
    slug: '6wk_gym'
  },
  '6wk_home': {
    name: '6 Week Burn & Build (Home)',
    price: 97,
    duration_weeks: 6,
    slug: '6wk_home'
  },
  '12wk': {
    name: '12 Week Custom Training',
    price: 200,
    duration_weeks: 12,
    slug: '12wk'
  },
  'pcos': {
    name: 'PCOS Warrior Program',
    price: 45,
    duration_weeks: 8,
    slug: 'pcos'
  },
  '40plus': {
    name: '40+ Strong Program',
    price: 50,
    duration_weeks: 8,
    slug: '40plus'
  },
  'zoom_trial': {
    name: 'Zoom Trial Session',
    price: 20,
    duration_weeks: 1,
    slug: 'zoom_trial'
  },
  'zoom_pack': {
    name: 'Zoom Session Pack',
    price: 597,
    duration_weeks: 4,
    slug: 'zoom_pack'
  }
};

function routeToProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (/pcos|hormonal|hormone/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joints|joint/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|flagship|personalise|personalize/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try/.test(lower)) return 'zoom_trial';
  if (/fat\s*loss|weight|shred|burn|lean|cut|slim|lose/.test(lower)) return '6wk_gym';
  if (/home|no\s*gym|bodyweight/.test(lower)) return '6wk_home';
  if (/gym|muscle|strength|build|bulk|gain/.test(lower)) return '6wk_gym';

  return null;
}

module.exports = { PROGRAMS, routeToProgram };
