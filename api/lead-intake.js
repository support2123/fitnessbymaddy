const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/escalation');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, phone, name, email, age, gender,
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_preference,
      training_experience, available_days, equipment_access,
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone or lead_id required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalation = needsEscalation(medicalText);
    if (escalation.escalate) {
      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendTemplate(maddyPhone, 'escalation_alert', [
        name || 'New intake',
        `Intake form flagged: ${escalation.reason}`,
        medicalText.slice(0, 200),
      ]);
    }

    const { data: submission, error } = await supabase
      .from('intake_submissions')
      .insert({
        lead_id: lead_id || null,
        phone, name, email, age, gender,
        height_cm, weight_kg, goal, injuries,
        medical_conditions, diet_preference,
        training_experience, available_days, equipment_access,
      })
      .select()
      .single();

    if (error) throw error;

    if (lead_id) {
      await supabase
        .from('leads')
        .update({ name: name || undefined })
        .eq('id', lead_id);
    }

    return res.status(200).json({ success: true, id: submission.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
