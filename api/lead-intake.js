const supabase = require('../lib/supabase');
const { needsEscalation, getEscalationReason, notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      lead_id, name, email, phone, age, gender, goal,
      injuries, medical_conditions, diet_preference,
      training_experience, schedule_preference,
      current_weight, target_weight
    } = body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    // Check for medical escalation triggers
    const combined = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(combined)) {
      const reason = getEscalationReason(combined);
      await notifyMaddy(phone || 'form-submission', combined, reason);
    }

    // Save intake submission
    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id: lead_id || null,
      name,
      email,
      phone: phone || null,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      training_experience: training_experience || null,
      schedule_preference: schedule_preference || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null
    }).select().single();

    if (error) {
      console.error('Intake save error:', error);
      return res.status(500).json({ error: 'Failed to save submission' });
    }

    // Update lead record if we have a lead_id
    if (lead_id) {
      await supabase.from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, id: data.id });

  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
