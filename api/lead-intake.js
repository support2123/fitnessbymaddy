const { getSupabase } = require('../lib/supabase');
const { json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      age,
      phone,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions
    } = req.body;

    if (!lead_id) {
      return json(res, { error: 'Missing lead_id' }, 400);
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) {
      return json(res, { error: 'Lead not found' }, 404);
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      await db.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule
      }).eq('id', existingClient.id);

      return json(res, { success: true, client_id: existingClient.id, updated: true });
    }

    return json(res, {
      success: true,
      message: 'Intake saved. Client record will be created upon payment.'
    });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
