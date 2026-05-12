const { getSupabase } = require('./_lib/supabase');
const { checkEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, goal,
      injuries, medical_conditions, diet_preference,
      workout_schedule, experience_level, current_weight, target_weight
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const db = getSupabase();

    const { data: submission, error } = await db.from('intake_submissions').insert({
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
      workout_schedule: workout_schedule || null,
      experience_level: experience_level || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null
    }).select('id').single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (medicalText) {
      const escalation = checkEscalation(medicalText);
      if (escalation.shouldEscalate) {
        await createEscalation(phone || 'unknown', escalation.reason, `Intake form: ${medicalText}`);
      }
    }

    return res.json({ ok: true, submission_id: submission.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
