const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, workout_days, experience,
      medical_conditions, current_supplements
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal,
      injuries, diet_pref, workout_days, experience,
      medical_conditions, current_supplements,
      submitted_at: new Date().toISOString()
    };

    const folderPath = `clients/${lead_id}/intake.json`;
    await supabase.storage
      .from('clients')
      .upload(folderPath, JSON.stringify(intakeData), {
        contentType: 'application/json',
        upsert: true
      });

    return res.json({ ok: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
