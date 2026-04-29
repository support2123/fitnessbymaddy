const { getSupabase } = require('../lib/supabase');
const { sendJson, sendError, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'POST only');

  const {
    lead_id, name, email, phone, age, gender, height, weight,
    goal, injuries, medical_conditions, diet_preference,
    schedule, experience_level, equipment_access, notes
  } = req.body || {};

  if (!lead_id) return sendError(res, 400, 'Missing lead_id');

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return sendError(res, 404, 'Lead not found');

  const updates = {};
  if (name) updates.name = name;
  if (phone) updates.phone = phone;

  if (Object.keys(updates).length > 0) {
    await db.from('leads').update(updates).eq('id', lead_id);
  }

  const intakeData = {
    email, age, gender, height, weight, goal,
    injuries, medical_conditions, diet_preference,
    schedule, experience_level, equipment_access, notes,
  };

  await db.from('leads').update({
    first_msg: JSON.stringify(intakeData),
    name: name || lead.name,
  }).eq('id', lead_id);

  const { escalateToMaddy } = require('../lib/escalation');
  if (injuries || medical_conditions) {
    const flagText = [injuries, medical_conditions].filter(Boolean).join('; ');
    await escalateToMaddy(
      lead.phone,
      'medical',
      `Intake form flagged: ${flagText}`
    );
  }

  return sendJson(res, 200, { success: true, lead_id });
};
