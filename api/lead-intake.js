const { getSupabase } = require('../lib/supabase');
const { cors, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, medical_conditions, diet_preference,
    meals_per_day, workout_experience, equipment_access,
    schedule_preference, phone,
  } = body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'Missing lead_id or phone' });
  }

  const db = getSupabase();

  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await db.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  if (name) {
    await db.from('leads').update({ name }).eq('id', lead.id);
  }

  const intakeData = {
    age, gender, height, weight, goal,
    injuries, medical_conditions, diet_preference,
    meals_per_day, workout_experience, equipment_access,
    schedule_preference,
    submitted_at: new Date().toISOString(),
  };

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead.id)
    .maybeSingle();

  if (existingClient) {
    await db
      .from('clients')
      .update({ intake_data: intakeData, name, email })
      .eq('id', existingClient.id);
  } else {
    await db.from('clients').insert({
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest || '6wk_gym',
      intake_data: intakeData,
      status: 'active',
    });
  }

  return res.status(200).json({ ok: true, message: 'Intake saved' });
};
