const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience,
      medical_conditions
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
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
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || 'None',
      diet_preference,
      schedule,
      experience,
      medical_conditions: medical_conditions || 'None',
      submitted_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name,
        program_interest: lead.program_interest,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
