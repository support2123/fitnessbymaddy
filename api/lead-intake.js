const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, experience_level, current_activity, notes,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, schedule,
      experience_level, current_activity, notes,
    };

    // Store intake as JSONB in lead's first_msg field (append)
    const updatedMsg = lead.first_msg
      ? `${lead.first_msg}\n---INTAKE---\n${JSON.stringify(intakeData)}`
      : `INTAKE: ${JSON.stringify(intakeData)}`;

    await supabase.from('leads')
      .update({ name: name || lead.name, first_msg: updatedMsg })
      .eq('id', lead_id);

    return res.json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
