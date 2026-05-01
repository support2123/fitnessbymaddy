const { getSupabase } = require('../lib/supabase');
const { jsonResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, {}, 200);
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, schedule, medical_conditions,
    phone,
  } = req.body || {};

  if (!lead_id && !phone) {
    return jsonResponse(res, { error: 'lead_id or phone required' }, 400);
  }

  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await db.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) return jsonResponse(res, { error: 'Lead not found' }, 404);

  await db.from('leads').update({
    name: name || lead.name,
  }).eq('id', lead.id);

  const intakeData = {
    lead_id: lead.id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    intake: {
      age, gender, height, weight, goal,
      injuries, diet_preference, schedule, medical_conditions,
    },
    submitted_at: new Date().toISOString(),
  };

  const { error } = await db.from('clients').upsert({
    lead_id: lead.id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    program: lead.program_interest,
    status: 'active',
  }, { onConflict: 'lead_id', ignoreDuplicates: true });

  if (error) console.error('Intake upsert error:', error.message);

  return jsonResponse(res, { ok: true, lead_id: lead.id });
};
