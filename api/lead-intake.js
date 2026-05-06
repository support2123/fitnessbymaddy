const { getSupabase } = require('../lib/supabase');
const { handleOptions } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, program,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const supabase = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({
          name: name || lead.name,
          email,
          age: age ? parseInt(age, 10) : null,
          goal,
          injuries,
          diet_pref,
          schedule,
        })
        .eq('id', existingClient.id);

      return res.status(200).json({ ok: true, client_id: existingClient.id, updated: true });
    }

    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: lead.phone,
        name: name || lead.name,
        email,
        program: program || lead.program_interest,
        age: age ? parseInt(age, 10) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ ok: true, client_id: newClient.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
