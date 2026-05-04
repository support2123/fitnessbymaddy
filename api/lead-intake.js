const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, email, phone,
      goal, injuries, diet_preference,
      schedule, medical_conditions, notes
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: goal || lead.program_interest
      })
      .eq('id', lead_id);

    const intakeData = {
      age, email, goal, injuries, diet_preference,
      schedule, medical_conditions, notes,
      submitted_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('leads')
      .update({ first_msg: JSON.stringify(intakeData) })
      .eq('id', lead_id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to submit form' });
  }
};
