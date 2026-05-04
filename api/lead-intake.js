const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, age, gender, goal, injuries, diet_preference,
      schedule, current_weight, target_weight, medical_conditions,
    } = req.body;

    const db = getSupabase();

    if (lead_id) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const { error } = await db.from('intake_forms').insert({
      lead_id: lead_id || null,
      name,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Intake form error:', error.message);
      return res.status(500).json({ error: 'Failed to save form' });
    }

    return res.status(200).json({ success: true, message: 'Form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
