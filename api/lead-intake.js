const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_days, equipment_access,
      wake_time, sleep_time, supplements, notes,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, training_experience,
      available_days, equipment_access, wake_time, sleep_time,
      supplements, notes, email, phone: phone || lead.phone,
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name: name || undefined,
        email: email || undefined,
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully. You\'ll receive your program details on WhatsApp shortly!',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
