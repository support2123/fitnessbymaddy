const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      experience_level, medical_conditions, current_activity
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, program_interest')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase
      .from('leads')
      .update({ name, status: 'qualified' })
      .eq('id', lead_id);

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id,
        phone: lead.phone,
        name,
        email,
        program: lead.program_interest || 'zoom_trial',
        status: 'pending',
        intake_data: {
          age, gender, height, weight, goal,
          injuries, diet_preference, schedule,
          experience_level, medical_conditions, current_activity
        }
      }, { onConflict: 'lead_id' })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
