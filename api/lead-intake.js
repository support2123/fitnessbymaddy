const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, equipment, experience_level, photos
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });

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
        status: lead.status === 'new' ? 'qualified' : lead.status
      })
      .eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, schedule,
      equipment, experience_level, photos
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData)
      })
      .eq('id', lead_id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Intake form submitted successfully' });

  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Failed to submit intake form' });
  }
};
