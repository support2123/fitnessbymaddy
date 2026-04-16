// WhatsApp sender. Tries AiSensy first; falls back to Meta Cloud API
// when AiSensy credentials are missing or the call fails.
// Every send is logged to `public.messages` for auditability.

import { supabase } from './supabase.js';
import { maskPhone, canSendOutbound } from './utils.js';

const AISENSY_URL = 'https://backend.aisensy.com/campaign/t1/api/v2';

// ─── Template library ────────────────────────────────────────
// Key is the internal name we reference from flows. `aisensy`
// is the campaignName configured in the AiSensy dashboard.
// Bodies are plain-text fallbacks used by Meta Cloud API.
export const TEMPLATES = {
  welcome_v1: {
    aisensy: 'welcome_v1',
    body_in: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
    body_en: "Hi! Maddy's team here 👋 What's the main goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?",
  },
  nudge_trial: {
    aisensy: 'nudge_trial',
    body_in: "Abhi decide karna mushkil lag raha ho toh $20 ka Zoom trial try karo — 1 session with Maddy, zero pressure. Link: {{link}}",
    body_en: "Not sure yet? Try the $20 Zoom trial — 1 session with Maddy, zero pressure. Link: {{link}}",
  },
  checkout_link: {
    aisensy: 'checkout_link',
    body_in: "Perfect! {{program_name}} tumhare liye best fit hai 🔥\n\nCheckout: {{checkout}}\nIntake form (1 min): {{intake}}",
    body_en: "Perfect — {{program_name}} is the right fit for you 🔥\n\nCheckout: {{checkout}}\nIntake form (1 min): {{intake}}",
  },
  onboard_6wk_gym:   { aisensy: 'onboard_6wk_gym',   body_in: "Welcome to the 6-Week Burn & Build 🔥 Pehli check-in 7 din baad hogi. Ready?" },
  onboard_6wk_home:  { aisensy: 'onboard_6wk_home',  body_in: "Welcome to 6-Week Home Edition 🏠 Equipment-free. Pehli check-in 7 din baad." },
  onboard_12wk:     { aisensy: 'onboard_12wk',      body_in: "Welcome to the 12-Week Flagship 👑 Tumhara personalised Week-1 program 10 minutes mein milega." },
  onboard_pcos:     { aisensy: 'onboard_pcos',      body_in: "Welcome to PCOS Warrior 💪 Hormonal-safe training + nutrition. Pehli check-in 7 din baad." },
  onboard_40plus:   { aisensy: 'onboard_40plus',    body_in: "Welcome to 40+ Strong ✨ Joint-friendly strength. Pehli check-in 7 din baad." },
  onboard_zoom_trial:{aisensy: 'onboard_zoom_trial',body_in: "Welcome! Trial booking link Maddy send karegi shortly." },
  onboard_zoom_pack:{ aisensy: 'onboard_zoom_pack', body_in: "Welcome to Zoom Pack 🎥 Session booking link coming up." },
  checkin_ready: {
    aisensy: 'checkin_ready',
    body_in: "Week {{week}} check-in ready ✅\n{{link}}\n\n2 min lagenge — weight, waist, 3 photos.",
    body_en: "Week {{week}} check-in is ready ✅\n{{link}}\n\nTakes 2 min — weight, waist, 3 photos.",
  },
  checkin_nudge: {
    aisensy: 'checkin_nudge',
    body_in: "Hey! Week {{week}} check-in pending hai. Quick submit: {{link}}",
    body_en: "Hey — Week {{week}} check-in still pending. Quick submit: {{link}}",
  },
  program_ready: {
    aisensy: 'program_ready',
    body_in: "Week {{week}} program ready 👊\n{{focus}}\n\nPDF: {{pdf}}",
    body_en: "Week {{week}} program is ready 👊\n{{focus}}\n\nPDF: {{pdf}}",
  },
  reengage_7d: {
    aisensy: 'reengage_7d',
    body_in: "Hi! Pichle hafte baat hui thi. Goal decide ho gaya? Trial link: {{link}}",
    body_en: "Hey! We spoke last week. Decided on a goal? Trial link: {{link}}",
  },
};

// Render template body for a given market (falls back to `body_in`).
function renderBody(tpl, market, params = {}) {
  const key = (market === 'IN' || !market) ? 'body_in' : 'body_en';
  let body = tpl[key] || tpl.body_in || tpl.body_en || '';
  for (const [k, v] of Object.entries(params)) {
    body = body.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v ?? ''));
  }
  return body;
}

// ─── Rate-limit guard + audit log ────────────────────────────
async function recordOutbound(phone, body, templateName, providerId, status) {
  await supabase.from('messages').insert({
    phone,
    direction: 'out',
    body,
    template_name: templateName,
    provider_id: providerId,
    status,
  });
}

// ─── AiSensy send ────────────────────────────────────────────
async function sendViaAiSensy({ phone, templateName, params }) {
  const apiKey = process.env.AISENSY_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no_aisensy_key' };
  const tpl = TEMPLATES[templateName];
  if (!tpl?.aisensy) return { ok: false, reason: 'no_aisensy_template' };

  const res = await fetch(AISENSY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey,
      campaignName: tpl.aisensy,
      destination: phone,
      userName: 'FitnessByMaddy',
      templateParams: Object.values(params || {}).map(String),
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, reason: `aisensy_${res.status}`, text };
  return { ok: true, providerId: safeId(text) };
}

// ─── Meta Cloud API send (fallback / free-form reply) ────────
async function sendViaMeta({ phone, body }) {
  const id = process.env.META_PHONE_NUMBER_ID;
  const token = process.env.META_ACCESS_TOKEN;
  if (!id || !token) return { ok: false, reason: 'no_meta_creds' };
  const res = await fetch(`https://graph.facebook.com/v20.0/${id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'text',
      text: { body, preview_url: false },
    }),
  });
  if (!res.ok) return { ok: false, reason: `meta_${res.status}`, text: await res.text() };
  const j = await res.json().catch(() => ({}));
  return { ok: true, providerId: j?.messages?.[0]?.id };
}

function safeId(maybeJson) {
  try { return JSON.parse(maybeJson)?.messageId || null; } catch { return null; }
}

// ─── Public: template send (respects rate limit) ─────────────
export async function sendTemplate({
  phone, templateName, params = {}, market = 'IN',
  isClient = false, lastOutboundAt = null, force = false,
}) {
  if (!force && !canSendOutbound(lastOutboundAt, isClient)) {
    return { ok: false, skipped: 'rate_limited' };
  }

  const tpl = TEMPLATES[templateName];
  if (!tpl) throw new Error(`unknown template: ${templateName}`);
  const body = renderBody(tpl, market, params);

  // Try AiSensy → Meta fallback.
  let result = await sendViaAiSensy({ phone, templateName, params });
  if (!result.ok) result = await sendViaMeta({ phone, body });

  await recordOutbound(phone, body, templateName, result.providerId, result.ok ? 'sent' : 'failed');
  if (!result.ok) {
    console.warn('[whatsapp] send failed', maskPhone(phone), result.reason);
  }
  return result;
}

// Free-form text (only valid inside the 24 hr customer-initiated window).
export async function sendText({ phone, body, isClient = false, lastOutboundAt = null, force = false }) {
  if (!force && !canSendOutbound(lastOutboundAt, isClient)) {
    return { ok: false, skipped: 'rate_limited' };
  }
  const result = await sendViaMeta({ phone, body });
  await recordOutbound(phone, body, null, result.providerId, result.ok ? 'sent' : 'failed');
  return result;
}

// Escalation ping to Maddy — always force, never rate-limited.
export async function pingMaddy(body) {
  const target = process.env.MADDY_ESCALATION_PHONE;
  if (!target) { console.warn('[whatsapp] no MADDY_ESCALATION_PHONE set'); return; }
  await sendText({ phone: target, body, force: true, isClient: true });
}
