const { getSupabase } = require('./lib/supabase');
const { handleCors, jsonError, jsonOk } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 'POST only', 405);

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, goal,
    injuries, diet_pref, schedule, experience_level,
    current_weight, target_weight, medical_conditions,
  } = req.body || {};

  if (!lead_id) return jsonError(res, 'lead_id required');

  const { data: lead, error } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (error || !lead) return jsonError(res, 'Lead not found', 404);

  await db.from('leads').update({
    name: name || lead.name,
  }).eq('id', lead_id);

  const clientData = {
    lead_id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    program: lead.program_interest,
    status: 'active',
  };

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', lead_id)
    .limit(1)
    .single();

  if (existingClient) {
    await db.from('clients').update({
      name: clientData.name,
      email,
    }).eq('id', existingClient.id);
  }

  const intakeMetadata = {
    age, gender, goal, injuries, diet_pref, schedule,
    experience_level, current_weight, target_weight, medical_conditions,
  };

  await db.from('messages').insert({
    phone: lead.phone,
    direction: 'in',
    body: JSON.stringify(intakeMetadata),
    template_name: 'intake_form',
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  return jsonOk(res, { received: true });
};
