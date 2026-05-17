const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, age, gender, goal, injuries, medical_conditions,
      diet_preference, workout_schedule, current_weight, target_weight,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag on intake form', {
        phone: lead.phone,
        message: `Injuries: ${injuries || 'none'}, Conditions: ${medical_conditions || 'none'}`,
      });
    }

    const { error } = await db.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      workout_schedule,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
    });

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
