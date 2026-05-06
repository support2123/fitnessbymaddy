const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      current_weight,
      goal_weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      available_equipment,
      weekly_schedule,
      wake_time,
      sleep_time,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead.id);

    const intakeData = {
      age, gender, height, current_weight, goal_weight,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_equipment, weekly_schedule,
      wake_time, sleep_time, email,
    };

    const { error } = await db.from('leads').update({
      intake_data: intakeData,
    }).eq('id', lead.id);

    if (error) {
      console.error('Intake save error:', error);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
