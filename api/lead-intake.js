const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, schedule, medical_conditions, current_weight,
      target_weight, height, experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name, email, age, gender, goal, injuries,
      diet_preference, schedule, medical_conditions,
      current_weight, target_weight, height, experience_level,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData,
    }).eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
