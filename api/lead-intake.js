const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_days,
      experience_level, medical_conditions, schedule_preference
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, workout_days, experience_level,
      medical_conditions, schedule_preference, email
    };

    // Store intake data as a JSON column or in metadata
    // For now we update the lead and use it during program generation
    const { error } = await supabase.from('leads').update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead_id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to submit' });
  }
};
