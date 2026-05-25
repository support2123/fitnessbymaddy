const { getSupabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/whatsapp');
const { escalate } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_days, workout_location, experience_level,
      schedule_notes
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
    }

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalate(phone, 'medical_condition_intake', medicalText);
    }

    await db.from('leads').update({
      name,
      status: 'qualified',
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const { data: client, error } = await db.from('clients').insert({
      lead_id,
      phone,
      name,
      email,
      program: '12wk',
      status: 'active',
      paid_amount: 0
    }).select().single();

    if (error) {
      if (error.code === '23505') {
        return res.status(200).json({ success: true, message: 'Intake already submitted' });
      }
      throw error;
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, workout_days,
      workout_location, experience_level, schedule_notes
    };

    await db.from('checkins').insert({
      client_id: client.id,
      week_no: 0,
      compliance_score: 5,
      energy: 5,
      issues: JSON.stringify(intakeData),
      next_week_focus: 'Initial assessment'
    });

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
