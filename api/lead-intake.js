const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, workout_experience, current_activity,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    const intakeData = {
      lead_id,
      name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, workout_experience, current_activity,
      submitted_at: new Date().toISOString(),
    };

    const folderPath = `intakes/${lead_id}.json`;
    await supabase.storage
      .from('clients')
      .upload(folderPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true,
      });

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('[lead-intake]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
