const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_days,
      equipment_access, wake_time, sleep_time, medical_conditions
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

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
      diet_preference, workout_days, equipment_access,
      wake_time, sleep_time, medical_conditions,
      submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ intake_data: intakeData, name, email })
        .eq('id', existingClient.id);
    } else {
      await supabase.from('clients').insert({
        lead_id,
        phone: lead.phone,
        name,
        email,
        program: lead.program_interest || '6wk_gym',
        status: 'active',
        intake_data: intakeData
      });
    }

    return res.status(200).json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
