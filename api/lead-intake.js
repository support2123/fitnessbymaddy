const { getSupabase } = require('../lib/supabase');
const { jsonResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      available_days,
      equipment_access,
      wake_time,
      sleep_time,
      stress_level,
      notes
    } = req.body;

    if (!lead_id && !phone) {
      return jsonResponse(res, 400, { error: 'lead_id or phone required' });
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
      return jsonResponse(res, 404, { error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, training_experience,
      available_days, equipment_access, wake_time, sleep_time,
      stress_level, notes, email
    };

    const { error: metaError } = await db.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || goal
    }).eq('id', lead.id);

    if (metaError) console.error('Lead update error:', metaError.message);

    return jsonResponse(res, 200, {
      ok: true,
      message: 'Intake form submitted successfully',
      lead_id: lead.id
    });
  } catch (err) {
    console.error(`[INTAKE ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
