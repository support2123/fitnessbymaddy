const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, phone,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone, status')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';
    updates.last_msg_at = new Date().toISOString();

    await db.from('leads').update(updates).eq('id', lead_id);

    // Check for escalation triggers in text fields
    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy(
        'intake_medical_flag',
        lead.phone,
        `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`
      );
    }

    // Store intake data as a JSON note on the lead (using a simple approach)
    const intakeData = {
      name, email, age, phone: lead.phone,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height,
      submitted_at: new Date().toISOString()
    };

    // Upsert into leads with program_interest derived from goal
    const programMap = {
      'fat_loss': '6wk_gym',
      'pcos': 'pcos',
      '40plus': '40plus',
      'muscle_building': '12wk',
      'general_fitness': '6wk_gym',
      'home_workout': '6wk_home'
    };

    const programInterest = programMap[goal] || null;
    if (programInterest) {
      await db.from('leads').update({ program_interest: programInterest }).eq('id', lead_id);
    }

    return res.json({ success: true, lead_id, intake: intakeData });

  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
