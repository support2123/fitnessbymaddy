const { getSupabase } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/helpers');
const { escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, phone, name, email, age, gender, goal,
      injuries, medical_conditions, diet_preference,
      training_experience, available_equipment,
      schedule_days, wake_time
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'phone or lead_id required' });
    }

    const db = getSupabase();

    const { data: form, error } = await db
      .from('intake_forms')
      .insert({
        lead_id: lead_id || null,
        phone,
        name,
        email,
        age: age ? parseInt(age, 10) : null,
        gender,
        goal,
        injuries,
        medical_conditions,
        diet_preference,
        training_experience,
        available_equipment,
        schedule_days: schedule_days ? parseInt(schedule_days, 10) : null,
        wake_time
      })
      .select()
      .single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    if (lead_id) {
      await db
        .from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    }

    const flagText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(flagText)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag in intake form',
        phone: phone || 'unknown',
        clientName: name,
        details: flagText.slice(0, 300)
      });
    }

    return res.status(200).json({ success: true, form_id: form.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
