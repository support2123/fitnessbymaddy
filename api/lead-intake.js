const { supabase } = require('./_lib/supabase');
const { cors, json, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, schedule,
    medical_conditions, experience_level,
  } = body;

  if (!lead_id) return json(res, 400, { error: 'lead_id required' });

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return json(res, 404, { error: 'Lead not found' });

  await supabase.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

  const intakeData = {
    age, gender, height, weight, goal, injuries,
    diet_preference, schedule, medical_conditions,
    experience_level, submitted_at: new Date().toISOString(),
  };

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('lead_id', lead_id)
    .limit(1)
    .single();

  if (existingClient) {
    await supabase
      .from('clients')
      .update({ name, email, intake_data: intakeData })
      .eq('id', existingClient.id);
  } else {
    await supabase.from('clients').insert({
      lead_id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest || '6wk_gym',
      status: 'active',
      intake_data: intakeData,
    });
  }

  return json(res, 200, { success: true, message: 'Intake form saved' });
};
