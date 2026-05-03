const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, age, gender, height, weight,
    goal, injuries, diet_pref, schedule,
    medical_conditions, experience_level
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const { error } = await supabase
    .from('leads')
    .update({
      name: name || undefined,
      intake_data: {
        age, gender, height, weight, goal,
        injuries, diet_pref, schedule,
        medical_conditions, experience_level,
        submitted_at: new Date().toISOString()
      }
    })
    .eq('id', lead_id);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
};
