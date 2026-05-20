const { getSupabase } = require('./lib/supabase');
const { parseBody, json } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, age, goal, injuries,
    diet_pref, schedule, medical_conditions,
  } = body;

  if (!lead_id) return json(res, 400, { error: 'lead_id required' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return json(res, 404, { error: 'lead not found' });

  if (name) await db.from('leads').update({ name }).eq('id', lead_id);

  const intakeData = { age, goal, injuries, diet_pref, schedule, medical_conditions };
  await db.from('leads').update({
    intake_data: intakeData,
  }).eq('id', lead_id);

  return json(res, 200, { success: true, lead_id });
};
