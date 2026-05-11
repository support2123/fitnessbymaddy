import { sendTemplate } from './whatsapp.js';
import { maskPhone } from './market.js';

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'side effect',
  'injury', 'pregnant', 'pregnancy', 'medication', 'surgery',
  'pain', 'dizzy', 'dizziness', 'faint', 'vomit',
  'eating disorder', 'anorexia', 'bulimia', 'binge',
  'not eating', 'starving myself',
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

export function needsEscalation(text) {
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw));
}

export function isOptOut(text) {
  const lower = text.toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
}

export async function escalateToMaddy(phone, reason, messageText) {
  const masked = maskPhone(phone);
  const alert = `ESCALATION from ${masked}: ${reason}\nMessage: "${messageText.slice(0, 200)}"`;
  console.warn(alert);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [masked, reason, messageText.slice(0, 100)], true);
  return { escalated: true };
}

export function detectProgram(text) {
  const lower = text.toLowerCase();
  if (/fat\s*loss|weight|shred|lean|cut/.test(lower)) return '6wk_gym';
  if (/pcos|hormonal|hormone|period|irregular/.test(lower)) return 'pcos';
  if (/40\+?|forty|menopause|joint|knee|back pain/.test(lower)) return '40plus';
  if (/custom|12\s*week|serious|transform|flagship/.test(lower)) return '12wk';
  if (/trial|zoom|not sure|try|test/.test(lower)) return 'zoom_trial';
  if (/home|no gym|bodyweight|at home/.test(lower)) return '6wk_home';
  return null;
}

export const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build (Gym)', price: 97, checkout: '6wk-gym' },
  '6wk_home': { name: '6-Week Burn & Build (Home)', price: 97, checkout: '6wk-home' },
  '12wk': { name: '12-Week Custom Flagship', price: 200, checkout: '12wk-custom' },
  'pcos': { name: 'PCOS Warrior Program', price: 45, checkout: 'pcos-warrior' },
  '40plus': { name: '40+ Strong Program', price: 50, checkout: '40plus-strong' },
  'zoom_trial': { name: 'Zoom Trial Session', price: 20, checkout: 'zoom-trial' },
  'zoom_pack': { name: 'Zoom 4-Pack', price: 70, checkout: 'zoom-4pack' },
};
