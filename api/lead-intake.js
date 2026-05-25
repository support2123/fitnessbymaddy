const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, medical_conditions,
      current_weight, target_weight, height,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight, height, email,
    };

    const checkTexts = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(checkTexts)) {
      await escalateToMaddy(
        'Medical flag on intake form',
        `Lead: ${name || 'Unknown'} (${lead.phone.slice(0, 3)}XXX...${lead.phone.slice(-3)})\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    await db.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || goal,
    }).eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
