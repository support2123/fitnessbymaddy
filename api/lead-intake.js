const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      current_activity,
      phone
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const escalationFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationFields)) {
      await escalateToMaddy(
        'Medical/injury flag on intake form',
        `Lead: ${name || 'Unknown'}\nPhone: ${lead.phone}\nInjuries: ${injuries || 'None'}\nMedical: ${medical_conditions || 'None'}`
      );
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form received! We\'ll get your program ready.',
      leadId: lead_id
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
