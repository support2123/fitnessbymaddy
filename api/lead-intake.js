const { getSupabase } = require('../lib/supabase');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender,
      goal, injuries, diet_preference,
      schedule, current_activity, medical_conditions,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      name: name || lead.name,
      email,
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || 'None',
      diet_preference: diet_preference || 'No preference',
      schedule: schedule || 'Flexible',
      current_activity: current_activity || 'None',
      medical_conditions: medical_conditions || 'None',
    };

    const { error: updateErr } = await db
      .from('leads')
      .update({
        name: intakeData.name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    if (updateErr) {
      console.error('Intake update failed for lead', lead_id, updateErr.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
