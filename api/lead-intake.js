const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_id, name, age, email, goal, injuries, diet_pref, schedule, equipment, experience } = req.body;

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
      .update({ name: name || lead.name })
      .eq('id', lead_id);

    const intakeData = { age, goal, injuries, diet_pref, schedule, equipment, experience };

    const { error } = await supabase
      .from('clients')
      .upsert({
        lead_id,
        phone: lead.phone,
        name: name || lead.name,
        email,
        program: lead.program_interest || '6wk_gym',
        status: 'active',
        intake_data: intakeData
      }, { onConflict: 'lead_id' });

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to process intake' });
  }
};
