// POST /api/lead-intake
// Called by /intake.html after a lead fills the onboarding form.
// Stores intake_json on the matching client row (or on the lead if not
// yet paid). Always runs the escalation filter on free-text fields.

import { supabase } from './_lib/supabase.js';
import { normalizePhone, detectEscalation, json } from './_lib/utils.js';
import { openEscalation } from './_lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const body = req.body || {};
  const leadId = body.lead_id;
  const phone  = normalizePhone(body.phone);
  const payload = {
    age: num(body.age),
    gender: s(body.gender),
    height_cm: num(body.height_cm),
    weight_kg: num(body.weight_kg),
    goal: s(body.goal),
    injuries: s(body.injuries),
    medications: s(body.medications),
    medical_conditions: s(body.medical_conditions),
    diet_pref: s(body.diet_pref),
    training_days: num(body.training_days),
    schedule_notes: s(body.schedule_notes),
    equipment: s(body.equipment),
    photos_urls: Array.isArray(body.photos_urls) ? body.photos_urls : [],
    consent: !!body.consent,
    submitted_at: new Date().toISOString(),
  };

  if (!payload.consent) return json(res, 400, { error: 'consent_required' });
  if (!leadId && !phone) return json(res, 400, { error: 'missing_identifier' });

  // Try to find existing client by lead_id or phone; otherwise stash
  // the intake on the lead row for when payment lands.
  let clientId = null;
  if (leadId) {
    const { data: c } = await supabase.from('clients')
      .select('id, phone').eq('lead_id', leadId).maybeSingle();
    if (c) clientId = c.id;
  }
  if (!clientId && phone) {
    const { data: c } = await supabase.from('clients')
      .select('id').eq('phone', phone).maybeSingle();
    if (c) clientId = c.id;
  }

  if (clientId) {
    await supabase.from('clients').update({ intake_json: payload }).eq('id', clientId);
  } else if (leadId) {
    await supabase.from('leads').update({
      // store on the lead so it carries over at conversion time
      first_msg: (payload.goal || '').slice(0, 240),
    }).eq('id', leadId);
    // Keep the raw intake temporarily on the lead via a side-channel table?
    // For now, attach to a message row so it's auditable.
    await supabase.from('messages').insert({
      phone: phone || 'unknown',
      direction: 'in',
      body: `[intake] ${JSON.stringify(payload).slice(0, 2000)}`,
      template_name: 'intake_form',
    });
  }

  // Escalate on medical/injury/med signals — same rules as WhatsApp flow.
  const medText = [payload.injuries, payload.medications, payload.medical_conditions]
    .filter(Boolean).join(' | ');
  const trigger = detectEscalation(medText);
  if (trigger) {
    await openEscalation({
      reason: `intake_trigger:${trigger}`,
      phone: phone || null,
      leadId: leadId || null,
      clientId,
      payload: { snippet: medText, matched: trigger },
    });
  }

  return json(res, 200, { ok: true });
}

function s(v) { return typeof v === 'string' ? v.trim() : null; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
