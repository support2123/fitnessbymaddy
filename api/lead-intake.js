const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, age, gender, height_cm, weight_kg,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_equipment, schedule_days,
      wake_time, sleep_time, photos_urls,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('phone')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('medical_flag_intake', {
        phone: maskPhone(lead.phone),
        message: medicalText,
      });
    }

    const { data: intake, error } = await supabase
      .from('intake_responses')
      .insert({
        lead_id,
        age: parseInt(age) || null,
        gender,
        height_cm: parseFloat(height_cm) || null,
        weight_kg: parseFloat(weight_kg) || null,
        goal,
        injuries,
        medical_conditions,
        diet_preference,
        training_experience,
        available_equipment,
        schedule_days: parseInt(schedule_days) || null,
        wake_time,
        sleep_time,
        photos_urls: photos_urls || [],
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, id: intake.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
