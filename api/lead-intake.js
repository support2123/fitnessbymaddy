const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height, email, intake_submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .maybeSingle();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name: name || undefined, email })
        .eq('id', existingClient.id);
    }

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${JSON.stringify(intakeData)}`
    });

    return res.json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
