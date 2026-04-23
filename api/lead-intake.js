const { getSupabase } = require('./lib/supabase');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sb = getSupabase();

  try {
    const body = await parseBody(req);
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await sb.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: existingClient } = await sb
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      await sb.from('clients').update({
        name: name || existingClient.name,
        email,
        age: age ? parseInt(age, 10) : null,
        goal,
        injuries,
        diet_pref,
        schedule
      }).eq('id', existingClient.id);

      return res.status(200).json({ success: true, client_id: existingClient.id, updated: true });
    }

    const clientData = {
      lead_id,
      phone: phone || lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest || '6wk_gym',
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active'
    };

    const { data: intake } = await sb
      .from('clients')
      .upsert(clientData, { onConflict: 'lead_id' })
      .select()
      .single();

    return res.status(200).json({ success: true, client_id: intake?.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
