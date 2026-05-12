const { supabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      schedule, workout_location, experience_level,
      current_weight, target_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Intake form: medical flag',
        `Lead: ${maskPhone(phone || '')}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    const updateData = { name };
    if (lead_id) {
      await supabase
        .from('leads')
        .update(updateData)
        .eq('id', lead_id);
    }

    const intakeData = {
      lead_id: lead_id || null,
      phone: phone || '',
      name, email, age, gender, goal, injuries,
      medical_conditions, diet_preference, schedule,
      workout_location, experience_level,
      current_weight, target_weight, height,
      submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase
        .from('clients')
        .update({ name, email })
        .eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, message: 'Intake received' });

  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
