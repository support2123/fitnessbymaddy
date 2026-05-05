const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  // CORS headers for form submissions
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, training_days,
    wake_time, sleep_time, experience_level, medical_conditions
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
  }

  try {
    // Update lead with name
    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    // Store intake data in client profile (will be linked on conversion)
    const { error } = await supabase
      .from('leads')
      .update({
        name,
        intake_data: {
          email, age, gender, height, weight, goal,
          injuries, diet_preference, training_days,
          wake_time, sleep_time, experience_level, medical_conditions
        }
      })
      .eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    return res.status(200).json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
