const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, experience_level, photos,
    } = body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

    const combinedText = [goal, injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(combinedText)) {
      await notifyMaddy(
        'Intake form — medical flag',
        `Lead: ${name} (${lead_id})\nGoal: ${goal}\nInjuries: ${injuries}\nMedical: ${medical_conditions}`
      );
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      medical_conditions, diet_preference, schedule,
      experience_level, photos, email,
    };

    await db
      .from('leads')
      .update({
        name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    return res.json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
