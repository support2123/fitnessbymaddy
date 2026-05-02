const supabase = require('./_lib/supabase');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://fitnessbymaddy.com',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    for (const [key, val] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, val);
    }
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  for (const [key, val] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, val);
  }

  try {
    const body = req.body || {};
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, experience } = body;

    // Validate required fields
    if (!lead_id || !name || !email) {
      return res.status(400).json({
        error: 'Missing required fields: lead_id, name, and email are required',
      });
    }

    // Verify lead exists
    const { data: lead, error: lookupErr } = await supabase
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .maybeSingle();

    if (lookupErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Build the full intake payload to store
    const intakeData = {
      name,
      email,
      age: age || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      submitted_at: new Date().toISOString(),
    };

    // Update lead: set name, store full intake as JSON in first_msg
    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    if (updateErr) {
      console.error('Failed to update lead with intake:', updateErr.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.status(200).json({ success: true, message: 'Intake received' });
  } catch (err) {
    console.error('lead-intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
