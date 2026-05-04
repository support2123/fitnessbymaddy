const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, age, gender, goal, injuries,
      medical_conditions, diet_preference,
      workout_schedule, current_fitness,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalation = needsEscalation(medicalText);
    if (escalation) {
      await escalateToMaddy(lead.phone, `intake_${escalation}`, medicalText);
    }

    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      current_fitness,
    }).select().single();

    if (error) throw error;

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
