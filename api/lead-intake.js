const { supabase } = require('../lib/supabase');
const { corsHeaders, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*').json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, photos_consent,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name, email, age: parseInt(age) || null,
        goal, injuries, diet_pref, schedule,
      }).eq('id', existingClient.id);

      return res.status(200).json({ ok: true, client_id: existingClient.id, updated: true });
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id,
      phone: phone || lead.phone,
      name,
      email,
      age: parseInt(age) || null,
      goal,
      injuries,
      diet_pref,
      schedule,
      status: 'active',
      program: lead.program_interest,
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    console.log(`Intake saved for lead ${maskPhone(lead.phone)}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
