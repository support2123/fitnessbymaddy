const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule,
    workout_experience, medical_conditions,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await db.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) {
    const { data: newLead } = await db.from('leads').insert({
      phone: phone || null,
      name: name || null,
      source: 'intake_form',
      status: 'new',
      first_msg: `Intake form: ${goal}`,
      last_msg_at: new Date().toISOString(),
      market: 'GLOBAL',
    }).select().single();
    lead = newLead;
  }

  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const intakeData = {
    lead_id: lead.id,
    name, email, phone: lead.phone, age, gender,
    goal, injuries, diet_pref, schedule,
    workout_experience, medical_conditions,
    submitted_at: new Date().toISOString(),
  };

  await db.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

  if (lead.phone) {
    await sendWhatsApp(lead.phone, 'intake_received', [
      name || 'there',
    ]);
  }

  return res.status(200).json({ ok: true, lead_id: lead.id });
};
