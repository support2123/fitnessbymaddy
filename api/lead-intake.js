const { getSupabase } = require('../lib/supabase');
const { json, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const body = await parseBody(req);
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, workout_schedule,
    medical_conditions, experience_level
  } = body;

  if (!lead_id) return json(res, { error: 'lead_id required' }, 400);

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return json(res, { error: 'lead not found' }, 404);

  await db.from('leads').update({
    name: name || lead.name,
  }).eq('id', lead_id);

  const intakeData = {
    age, gender, height, weight, goal,
    injuries, diet_preference, workout_schedule,
    medical_conditions, experience_level,
  };

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead_id)
    .single();

  if (existingClient) {
    await db.from('clients').update({
      name: name || lead.name,
      email,
    }).eq('id', existingClient.id);
  }

  // Store intake data as a JSON file in storage for program generation
  const fileName = `intake_${lead_id}.json`;
  await db.storage
    .from('clients')
    .upload(fileName, JSON.stringify(intakeData, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });

  return json(res, { ok: true, lead_id });
};
