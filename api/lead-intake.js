import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, workout_schedule,
      experience_level, current_weight, target_weight,
      medical_conditions
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
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
        name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      workout_schedule, experience_level,
      current_weight, target_weight, medical_conditions
    };

    await supabase
      .from('leads')
      .update({
        name,
        program_interest: lead.program_interest || goal,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    // Store intake details as a message for reference
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    return res.status(200).json({ success: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
