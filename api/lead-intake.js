const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const {
    lead_id, name, email, age, gender, goal,
    injuries, diet_preference, schedule,
    current_weight, height, activity_level,
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
  }

  // Update lead with intake data
  const { error } = await supabase
    .from('leads')
    .update({
      name: name || undefined,
      intake_data: {
        email, age, gender, goal, injuries,
        diet_preference, schedule, current_weight,
        height, activity_level,
        submitted_at: new Date().toISOString(),
      },
    })
    .eq('id', lead_id);

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ success: true });
};
