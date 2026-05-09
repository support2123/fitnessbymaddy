const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, email, phone,
      goal, injuries, diet_preference,
      schedule, medical_conditions, notes
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    // Verify lead exists
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    // Update lead with intake info
    await supabase
      .from('leads')
      .update({
        name: name || undefined,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    // Store intake data as a note on the lead (extend via metadata column if needed)
    // For now, store in a simple structure in the client record once converted
    // We'll attach this as JSON in program_interest field temporarily
    const intakeData = JSON.stringify({
      age, email, goal, injuries,
      diet_preference, schedule,
      medical_conditions, notes
    });

    await supabase
      .from('leads')
      .update({ program_interest: intakeData })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake form received' });

  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
