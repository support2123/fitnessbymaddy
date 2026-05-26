const { getSupabase } = require('../lib/supabase');
const { jsonResponse, errorResponse, handleOptions } = require('../lib/utils');

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const data = await req.json();
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = data;

    if (!lead_id) return errorResponse('Missing lead_id');

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return errorResponse('Lead not found', 404);

    await db.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      phone: phone || lead.phone,
      submitted_at: new Date().toISOString()
    };

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existing) {
      await db.from('clients').update({
        name, email
      }).eq('id', existing.id);
    }

    return jsonResponse({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return errorResponse('Internal error', 500);
  }
};
