const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      workout_schedule, experience_level, current_weight,
      target_weight, height,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'lead_id, name, and email are required' });
    }

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy(
        'Medical/injury flag in intake form',
        `Lead: ${lead_id}\nName: ${name}\nDetails: ${allText.substring(0, 300)}`,
        { supabase }
      );
    }

    await supabase
      .from('leads')
      .update({
        name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { error } = await supabase.from('intake_forms').insert({
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      experience_level,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height,
      submitted_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
