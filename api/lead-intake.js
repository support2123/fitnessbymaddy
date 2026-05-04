const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, goal, injuries, diet_pref,
      schedule, medical_conditions, current_fitness, photos
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

    if (name) {
      await supabase
        .from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_fitness: current_fitness || null,
      submitted_at: new Date().toISOString()
    };

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existing) {
      return res.status(200).json({ message: 'Already a client', client_id: existing.id });
    }

    return res.status(200).json({
      message: 'Intake received. Awaiting payment to complete onboarding.',
      lead_id
    });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
