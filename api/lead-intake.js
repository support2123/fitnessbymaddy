const { supabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_preference,
      training_days, training_location, wake_time, sleep_time
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Medical flag on intake form',
        `Name: ${name}\nConditions: ${medical_conditions || 'none'}\nInjuries: ${injuries || 'none'}`
      );
    }

    const { data, error } = await supabase
      .from('intake_submissions')
      .insert({
        lead_id: lead_id || null,
        phone: phone || null,
        name, email, age: age ? parseInt(age) : null,
        gender, height_cm: height_cm ? parseFloat(height_cm) : null,
        weight_kg: weight_kg ? parseFloat(weight_kg) : null,
        goal, injuries, medical_conditions,
        diet_preference, training_days: training_days ? parseInt(training_days) : null,
        training_location, wake_time, sleep_time
      })
      .select()
      .single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    if (lead_id) {
      await supabase
        .from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
