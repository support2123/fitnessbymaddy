export const PROGRAMS = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, duration_weeks: 6 },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, duration_weeks: 6 },
  '12wk': { name: '12-Week Custom Training', price: 200, duration_weeks: 12 },
  pcos: { name: 'PCOS Warrior', price: 45, duration_weeks: 8 },
  '40plus': { name: '40+ Strong', price: 50, duration_weeks: 8 },
  zoom_trial: { name: 'Zoom Trial Session', price: 20, duration_weeks: 1 },
  zoom_pack: { name: 'Zoom Pack (4 Sessions)', price: 70, duration_weeks: 4 },
};

export const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'mature'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
];

export const ESCALATION_KEYWORDS = [
  'injury', 'injured', 'medical', 'doctor', 'pregnancy', 'pregnant',
  'medication', 'medicine', 'pain', 'dizzy', 'dizziness', 'faint',
  'eating disorder', 'anorexia', 'bulimia', 'purge', 'binge',
  'refund', 'lawyer', 'complaint', 'didn\'t work', 'side effect',
  'not working', 'worse', 'hospital',
];

export const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

export const MADDY_PHONE = '917082478374';

export const WELCOME_MSG_HINGLISH = "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?";
export const WELCOME_MSG_ENGLISH = "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

export const NUDGE_TRIAL_HINGLISH = "Hey! Abhi tak decide nahi hua? Ek $20 trial session try karo — Maddy ke saath live Zoom call. No commitment. Link: ";
export const NUDGE_TRIAL_ENGLISH = "Hey! Haven't decided yet? Try a $20 trial session — a live Zoom call with Maddy. No commitment. Link: ";

export const BASE_URL = 'https://www.fitnessbymaddy.com';
export const EXLY_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
