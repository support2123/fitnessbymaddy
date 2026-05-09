const { getSupabase } = require('./_lib/supabase');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, phone, age, gender, height, weight,
    goal, injuries, diet_preference, schedule, experience,
    medical_conditions, current_activity
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  try {
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, schedule, experience,
      medical_conditions, current_activity
    };

    await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData
    }).eq('id', lead_id);

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
