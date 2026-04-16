// Public intake form submit handler.
// Body: { lead, name, email, age, goal, injuries, diet, schedule, phone }

import { db } from '../lib/supabase.js';
import { json, readBody } from '../lib/http.js';
import { normalizePhone, maskPhone } from '../lib/pii.js';
import { detectEscalation, raiseEscalation } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const body = await readBody(req);
  const leadId = body.lead || body.lead_id || null;
  const phone = normalizePhone(body.phone);

  if (!leadId && !phone) {
    return json(res, 400, { error: 'missing_identity' });
  }

  const profile = {
    age: toInt(body.age),
    goal: clean(body.goal),
    injuries: clean(body.injuries),
    diet: clean(body.diet),
    schedule: clean(body.schedule),
    experience: clean(body.experience),
    location: clean(body.location),
    submitted_at: new Date().toISOString()
  };

  const sb = db();

  let lead = null;
  if (leadId) {
    const q = await sb.from('leads').select('*').eq('id', leadId).maybeSingle();
    lead = q.data;
  }
  if (!lead && phone) {
    const q = await sb.from('leads').select('*').eq('phone', phone).maybeSingle();
    lead = q.data;
  }

  if (!lead) {
    const insert = await sb.from('leads').insert({
      phone: phone || `intake_${Date.now()}`,
      name: clean(body.name) || null,
      source: 'intake_form',
      status: 'new'
    }).select().single();
    lead = insert.data;
  }

  // Store profile blob inside messages meta (no dedicated profile table yet — keeps schema lean).
  await sb.from('messages').insert({
    phone: lead.phone,
    direction: 'in',
    body: 'Intake form submitted',
    template_name: 'intake_form',
    status: 'received',
    meta: { profile, name: body.name, email: body.email }
  });

  // Client record: upsert profile onto clients row if one exists.
  if (lead) {
    const { data: client } = await sb.from('clients').select('id, folder_url').eq('lead_id', lead.id).maybeSingle();
    if (client) {
      await sb.from('clients').update({
        name: clean(body.name) || undefined,
        email: clean(body.email) || undefined
      }).eq('id', client.id);
    }
  }

  // Escalation on injuries / medical context.
  const flagText = [profile.injuries, profile.goal].filter(Boolean).join(' | ');
  const kw = detectEscalation(flagText);
  if (kw) {
    await raiseEscalation({
      phone: lead.phone,
      lead_id: lead.id,
      reason: `intake:${kw}`,
      context: flagText.slice(0, 400)
    });
  }

  console.log(`[lead-intake] ${maskPhone(lead.phone)} profile captured`);
  return json(res, 200, { ok: true, lead_id: lead.id });
}

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s.slice(0, 500) : null;
}
function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
