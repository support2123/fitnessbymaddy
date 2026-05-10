const { getSupabase } = require('../lib/supabase');
const { parseBody, jsonResp, corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResp(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return jsonResp(res, 400, { error: 'Invalid request body' });
  }

  const leadId = body.lead_id;
  if (!leadId) return jsonResp(res, 400, { error: 'Missing lead_id' });

  const { data: lead } = await db
    .from('leads')
    .select('id, phone')
    .eq('id', leadId)
    .single();

  if (!lead) return jsonResp(res, 404, { error: 'Lead not found' });

  const intakeData = {
    name: body.name || '',
    email: body.email || '',
    age: body.age || null,
    gender: body.gender || '',
    height: body.height || '',
    weight: body.weight || '',
    goal: body.goal || '',
    injuries: body.injuries || '',
    medical_conditions: body.medical_conditions || '',
    diet_preference: body.diet_preference || '',
    training_experience: body.training_experience || '',
    available_equipment: body.available_equipment || '',
    weekly_schedule: body.weekly_schedule || '',
    additional_notes: body.additional_notes || '',
  };

  await db.from('leads').update({
    name: intakeData.name || undefined,
    intake_data: intakeData,
    last_msg_at: new Date().toISOString(),
  }).eq('id', leadId);

  return jsonResp(res, 200, {
    success: true,
    message: 'Intake form submitted successfully',
  });
};
