const supabase = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_schedule,
      equipment_access, medical_conditions, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).maybeSingle();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, weight, goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      workout_schedule: workout_schedule || null,
      equipment_access: equipment_access || null,
      medical_conditions: medical_conditions || null,
      email: email || null,
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .maybeSingle();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || undefined,
        email: email || undefined,
      }).eq('id', existingClient.id);
    }

    // Store intake data as a JSON note in the lead's first_msg field appendage
    const existingMsg = lead.first_msg || '';
    await supabase.from('leads').update({
      first_msg: existingMsg + '\n---INTAKE---\n' + JSON.stringify(intakeData),
    }).eq('id', lead.id);

    return res.json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
