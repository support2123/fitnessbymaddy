const { supabase } = require('../lib/supabase');
const { checkEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, gender, phone, email,
      goal, injuries, medical_conditions, diet_preference,
      workout_days_per_week, equipment_access,
      current_weight, target_weight, wake_time, sleep_time
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalation = checkEscalation(medicalText);
    if (escalation) {
      await createEscalation({
        phone,
        leadId: lead_id || null,
        reason: `Medical flag in intake form: "${escalation}"`,
        triggerMessage: medicalText
      });
    }

    const { data, error } = await supabase
      .from('intake_forms')
      .insert({
        lead_id: lead_id || null,
        name, age, gender, phone, email,
        goal, injuries, medical_conditions, diet_preference,
        workout_days_per_week, equipment_access,
        current_weight, target_weight, wake_time, sleep_time
      })
      .select()
      .single();

    if (error) {
      console.error('Intake form insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
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
    return res.status(500).json({ error: 'Internal server error' });
  }
};
