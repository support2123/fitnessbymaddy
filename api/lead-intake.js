const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id required' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      intake_data: {
        age, gender, height, weight,
        goal, injuries, diet_preference, schedule,
        medical_conditions, experience_level,
        submitted_at: new Date().toISOString()
      }
    }).eq('id', lead_id);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
