const { supabase } = require('../lib/supabase');
const { sanitizeInput } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, medications, experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).maybeSingle();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: sanitizeInput(name) || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name: sanitizeInput(name),
      email: sanitizeInput(email),
      age: parseInt(age) || null,
      gender: sanitizeInput(gender),
      height: sanitizeInput(height),
      weight: parseFloat(weight) || null,
      goal: sanitizeInput(goal),
      injuries: sanitizeInput(injuries),
      diet_preference: sanitizeInput(diet_preference),
      schedule: sanitizeInput(schedule),
      medical_conditions: sanitizeInput(medical_conditions),
      medications: sanitizeInput(medications),
      experience_level: sanitizeInput(experience_level),
      submitted_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('intake_forms').upsert(intakeData, {
      onConflict: 'lead_id',
    });

    if (error) {
      const { error: metaError } = await supabase.from('leads').update({
        first_msg: JSON.stringify(intakeData),
      }).eq('id', lead_id);
    }

    return res.json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
