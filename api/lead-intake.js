const { getSupabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, schedule, medical_conditions, experience_level,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const db = getSupabase();

    // Update lead with intake data
    await db
      .from('leads')
      .update({
        name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    // Store extended profile in clients table (pre-create if needed)
    // This gets merged when conversion happens via Exly webhook
    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      schedule, medical_conditions, experience_level, email,
    };

    // Check for medical escalation
    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy(
        'Medical flag on intake form',
        `Lead ${lead_id}: ${allText.slice(0, 200)}`
      );
    }

    // Store intake as a metadata JSON in the lead's first_msg (simple approach)
    // or we could add a separate intake_data column — for now, update lead
    await db
      .from('leads')
      .update({
        name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
