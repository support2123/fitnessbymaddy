const { getClient } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/utils');
const { notifyMaddy } = require('../lib/escalation');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();

  try {
    const {
      lead_id, name, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      meals_per_day, workout_experience, equipment_access,
      schedule, phone, email,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await notifyMaddy(
        'Medical flag on intake form',
        `Lead: ${maskPhone(phone || 'unknown')} — ${medicalText.slice(0, 200)}`
      );
    }

    const updates = {
      name: name || undefined,
      last_msg_at: new Date().toISOString(),
    };

    if (lead_id) {
      await db.from('leads').update(updates).eq('id', lead_id);
    } else if (phone) {
      const cleaned = phone.replace(/\D/g, '');
      await db.from('leads').update(updates).eq('phone', cleaned);
    }

    const intakeData = {
      lead_id: lead_id || null,
      phone: phone ? phone.replace(/\D/g, '') : null,
      name, age, gender, height, weight, goal,
      injuries, medical_conditions, diet_preference,
      meals_per_day, workout_experience, equipment_access,
      schedule, email,
      submitted_at: new Date().toISOString(),
    };

    await db.from('messages').insert({
      phone: phone ? phone.replace(/\D/g, '') : 'unknown',
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
