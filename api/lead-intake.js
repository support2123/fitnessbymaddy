const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, schedule, medical_conditions,
      current_weight, height, target_weight,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone, name')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_weight: parseFloat(current_weight) || null,
      height: parseFloat(height) || null,
      target_weight: parseFloat(target_weight) || null,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData,
    }).eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error);
      return res.status(500).json({ error: 'Failed to save' });
    }

    return res.json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
