// Intake form handler. Accepts submissions from /intake.html and links
// them to the lead record (if ?lead=<id> provided).

import { db } from '../lib/supabase.js';
import { detectEscalations, escalate } from '../lib/escalation.js';
import { readJson, json, methodNotAllowed, cors } from '../lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = await readJson(req);
  const {
    lead_id, phone, name, email, age, sex, height_cm, weight_kg,
    goal, injuries, diet_pref, equipment, schedule, market
  } = body || {};

  if (!phone || !name) return json(res, 400, { ok: false, error: 'missing_phone_or_name' });

  // Store the structured intake inside leads.first_msg meta (jsonb-ish) via update.
  const profile = { age, sex, height_cm, weight_kg, goal, injuries, diet_pref, equipment, schedule };

  const updates = {
    phone, name, market,
    last_msg_at: new Date().toISOString()
  };

  let leadId = lead_id;
  if (leadId) {
    await db().from('leads').update(updates).eq('id', leadId);
  } else {
    const { data } = await db()
      .from('leads')
      .upsert({ ...updates, status: 'qualified', source: 'intake_form' }, { onConflict: 'phone' })
      .select().single();
    leadId = data?.id;
  }

  // Profile lands in messages audit as a 'form' entry (we don't have a dedicated
  // profiles table in the brief; keep everything searchable there).
  await db().from('messages').insert({
    phone, direction: 'in', body: JSON.stringify(profile),
    template_name: 'intake_form', status: 'received',
    meta: { lead_id: leadId, profile }
  });

  // Flag any medical/risk keywords for Maddy
  const risky = [injuries, goal, diet_pref].filter(Boolean).join(' ');
  for (const reason of detectEscalations(risky)) {
    await escalate({ phone, body: risky, leadId, reason, context: `intake: ${reason}` });
  }

  return json(res, 200, { ok: true, lead_id: leadId });
}
