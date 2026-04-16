// POST /api/lead-intake — handler for the public intake form.
// Body: { lead_id, name, email, age, sex, goal, injuries, diet, schedule,
//         equipment, photos[], phone? }
import { db, STORAGE_BUCKET } from './_lib/supabase.js';
import { detectEscalation, escalate } from './_lib/escalation.js';
import { ok, bad, readJson, normalisePhone } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const body = await readJson(req);

  const leadId = body.lead_id;
  if (!leadId) return res.status(400).json({ ok: false, error: 'lead_id required' });

  const supa = db();
  const { data: lead, error } = await supa
    .from('leads').select('*').eq('id', leadId).maybeSingle();
  if (error || !lead) return res.status(404).json({ ok: false, error: 'lead not found' });

  // Persist intake details onto the lead row (jsonb-like via meta is overkill;
  // store in lead.first_msg + a structured payload in the messages audit).
  const intake = {
    name: body.name || lead.name,
    email: body.email || null,
    age: body.age || null,
    sex: body.sex || null,
    goal: body.goal || null,
    injuries: body.injuries || null,
    diet: body.diet || null,
    schedule: body.schedule || null,
    equipment: body.equipment || null,
    photos: Array.isArray(body.photos) ? body.photos : [],
    phone: normalisePhone(body.phone) || lead.phone,
  };

  await supa.from('leads').update({
    name: intake.name,
    program_interest: lead.program_interest || body.goal || null,
  }).eq('id', leadId);

  await supa.from('messages').insert({
    phone: intake.phone || lead.phone,
    direction: 'in',
    body: 'INTAKE_FORM',
    template_name: 'intake_v1',
    meta: { intake },
  });

  // Auto-escalate medical / injury disclosures.
  const concerns = [intake.injuries, intake.goal].filter(Boolean).join(' ');
  const trig = detectEscalation(concerns);
  if (trig) {
    await escalate({
      phone: intake.phone || lead.phone,
      leadId,
      trigger: `intake_form:${trig}`,
      context: concerns.slice(0, 280),
    });
  }

  return res.status(200).json({ ok: true });
}
