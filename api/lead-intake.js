const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

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
      age, gender, goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height, email
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({
        success: true,
        message: 'Intake received, client already exists',
        client_id: existingClient[0].id
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form saved. Complete your purchase to activate your program.',
      lead_id,
      intake: intakeData
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
