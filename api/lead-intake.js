const { supabase } = require('./lib/supabase');
const { corsHeaders, json, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const leadId = body.lead_id;

    if (!leadId) return json(res, 400, { error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (!lead) return json(res, 404, { error: 'Lead not found' });

    const submission = {
      lead_id: leadId,
      age: body.age ? parseInt(body.age) : null,
      gender: body.gender || null,
      height_cm: body.height_cm ? parseFloat(body.height_cm) : null,
      weight_kg: body.weight_kg ? parseFloat(body.weight_kg) : null,
      goal: body.goal || null,
      injuries: body.injuries || null,
      medical_conditions: body.medical_conditions || null,
      diet_preference: body.diet_preference || null,
      meals_per_day: body.meals_per_day ? parseInt(body.meals_per_day) : null,
      workout_days_per_week: body.workout_days_per_week ? parseInt(body.workout_days_per_week) : null,
      equipment_access: body.equipment_access || null,
      schedule_preference: body.schedule_preference || null
    };

    const { error } = await supabase.from('intake_submissions').insert(submission);
    if (error) return json(res, 500, { error: 'Failed to save submission' });

    if (body.name && !lead.name) {
      await supabase.from('leads').update({ name: body.name }).eq('id', leadId);
    }

    return json(res, 200, { success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return json(res, 500, { error: 'Internal server error' });
  }
};
