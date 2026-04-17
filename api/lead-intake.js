const { getSupabase } = require('../lib/supabase');
const { parseBody, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule,
    experience, medical_conditions,
  } = body;

  if (!lead_id) return json(res, 400, { error: 'lead_id required' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return json(res, 404, { error: 'Lead not found' });

  const updateData = {};
  if (name) updateData.name = name;

  const { error } = await db.from('leads').update(updateData).eq('id', lead_id);

  const { error: metaError } = await db.from('lead_intake').upsert({
    lead_id,
    name: name || lead.name,
    email,
    phone: phone || lead.phone,
    age: age ? parseInt(age) : null,
    gender,
    goal,
    injuries,
    diet_pref,
    schedule,
    experience,
    medical_conditions,
    submitted_at: new Date().toISOString(),
  });

  if (metaError) {
    console.error('Intake save error:', metaError.message);
    return json(res, 500, { error: 'Failed to save intake' });
  }

  return json(res, 200, { success: true, lead_id });
};
