const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      age,
      email,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_weight,
      target_weight,
      experience_level,
      medical_conditions,
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
        program_interest: goal || lead.program_interest,
      })
      .eq('id', lead_id);

    const intakeData = {
      age,
      goal,
      injuries,
      diet_preference,
      schedule,
      current_weight,
      target_weight,
      experience_level,
      medical_conditions,
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase.from('checkins').insert({
        client_id: existingClient.id,
        week_no: 0,
        weight: current_weight,
        issues: JSON.stringify(intakeData),
        compliance_score: 5,
        energy: 5,
      });
    }

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('[lead-intake]', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
