// Escalation + safety gates.

import { db } from './supabase.js';
import { notifyMaddy } from './whatsapp.js';
import { maskPhone } from './pii.js';

export const ESCALATION_KEYWORDS = [
  'refund', 'lawyer', 'complaint', "didn't work", 'didnt work',
  'side effect', 'side-effect', 'pregnan', 'pregnant',
  'injury', 'injured', 'medical', 'medication', 'medicine',
  'pain', 'dizzy', 'dizziness', 'fainted', 'faint',
  'eating disorder', 'anorex', 'bulim', 'purge', 'starv'
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out'];

export function detectEscalation(text) {
  if (!text) return null;
  const lower = String(text).toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

export function isOptOut(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase().trim();
  return OPT_OUT_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw + ' '));
}

export async function raiseEscalation({ phone, lead_id, client_id, reason, context }) {
  try {
    await db().from('escalations').insert({
      phone, lead_id, client_id, reason, context
    });
  } catch (e) {
    console.error('raiseEscalation insert failed', e?.message);
  }
  await notifyMaddy(
    `⚠️ Escalation — ${reason}\nFrom: ${maskPhone(phone)}\n${(context || '').slice(0, 400)}`
  );
}

// Safety gate for Claude-generated programs.
// Returns { safe: bool, reason?: string }.
export function isRiskyPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return { safe: false, reason: 'empty_plan' };
  }
  const raw = JSON.stringify(plan).toLowerCase();

  const banned = [
    'clenbuterol', 'ephedrine', 'dnp', 'anabolic', 'steroid',
    'ozempic', 'semaglutide', 'hcg', 'diuretic', 'laxative'
  ];
  for (const word of banned) {
    if (raw.includes(word)) return { safe: false, reason: `banned_term:${word}` };
  }

  // Unrealistic calorie floor check.
  const nutrition = plan.nutrition_plan || plan.nutrition || {};
  const cals = Number(nutrition.daily_calories || nutrition.calories || 0);
  if (cals && cals < 1100) {
    return { safe: false, reason: `calorie_floor:${cals}` };
  }

  // Unrealistic weekly loss claim.
  const notes = String(plan.notes || '').toLowerCase();
  if (/\blose\s+\d+\s*kg\s*(per|\/|a)\s*week\b/.test(notes)) {
    return { safe: false, reason: 'unrealistic_loss_claim' };
  }

  return { safe: true };
}
