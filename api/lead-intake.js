const { getSupabase } = require('./_lib/supabase');
const { jsonResponse } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, goal,
      injuries, diet_pref, schedule, phone
    } = req.body;

    if (!lead_id) return jsonResponse(res, 400, { error: 'Missing lead_id' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return jsonResponse(res, 404, { error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existing) {
      await db.from('clients').update({
        name, email, age: age ? parseInt(age) : null,
        goal, injuries, diet_pref, schedule
      }).eq('id', existing.id);

      return jsonResponse(res, 200, { ok: true, client_id: existing.id, updated: true });
    }

    const { data: client } = await db.from('clients').insert({
      lead_id,
      phone: phone || lead.phone,
      name,
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      program: lead.program_interest,
      status: 'active'
    }).select().single();

    return jsonResponse(res, 200, { ok: true, client_id: client?.id });
  } catch (err) {
    console.error('[Intake Error]', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
