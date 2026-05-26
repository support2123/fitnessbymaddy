const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy, maskPhone } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, schedule, medical_conditions,
      experience_level, equipment_access,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const intakeData = {
      name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, schedule, medical_conditions,
      experience_level, equipment_access,
    };

    const escalationFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationFields)) {
      await escalateToMaddy(
        'Medical/injury flag in intake form',
        `Lead: ${maskPhone(phone || '')}\nName: ${name}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[Intake form submitted] ${JSON.stringify(intakeData)}`,
    });

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
