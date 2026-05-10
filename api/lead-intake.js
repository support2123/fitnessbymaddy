const { getSupabase } = require('../lib/supabase');
const { cors, parseBody } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const leadId = body.lead_id;
  if (!leadId) return res.status(400).json({ error: 'Missing lead_id' });

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  const intakeData = {
    name: body.name || lead.name,
    age: parseInt(body.age) || null,
    gender: body.gender || null,
    height_cm: parseFloat(body.height_cm) || null,
    weight_kg: parseFloat(body.weight_kg) || null,
    goal: body.goal || null,
    injuries: body.injuries || null,
    medical_conditions: body.medical_conditions || null,
    diet_preference: body.diet_preference || null,
    training_experience: body.training_experience || null,
    equipment_access: body.equipment_access || null,
    days_per_week: parseInt(body.days_per_week) || null,
    wake_time: body.wake_time || null,
    sleep_time: body.sleep_time || null,
    email: body.email || null,
  };

  await supabase
    .from('leads')
    .update({
      name: intakeData.name,
    })
    .eq('id', leadId);

  const { error } = await supabase
    .from('intake_forms')
    .upsert({
      lead_id: leadId,
      ...intakeData,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake form' });
  }

  return res.status(200).json({ ok: true, message: 'Intake form saved' });
};
