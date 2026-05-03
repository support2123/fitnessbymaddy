const { getSupabase } = require('./lib/supabase');
const { parseBody, corsHeaders, json } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical, experience
    } = body;

    if (!lead_id) return json(res, { error: 'lead_id required' }, 400);

    const sb = getSupabase();

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return json(res, { error: 'lead not found' }, 404);

    await sb.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = { age, gender, height, weight, goal, injuries, diet_pref, schedule, medical, experience };

    const { error } = await sb
      .from('clients')
      .upsert({
        lead_id,
        phone: phone || lead.phone,
        name: name || lead.name,
        email,
        status: 'active',
        intake_data: intakeData
      }, { onConflict: 'lead_id', ignoreDuplicates: false });

    if (error) {
      console.error('Intake save error:', error.message);
      return json(res, { error: 'save failed' }, 500);
    }

    return json(res, { ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return json(res, { error: 'internal' }, 500);
  }
};
