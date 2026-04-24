const { getSupabase } = require('../lib/supabase');
const { corsHeaders, needsEscalation, maskPhone } = require('../lib/utils');
const { notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      schedule, equipment, experience_level, notes
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, schedule, equipment, experience_level, notes, email
    };

    const escalationText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    if (needsEscalation(escalationText)) {
      await notifyMaddy(
        'Intake form — medical flag',
        `Lead: ${name || maskPhone(phone || lead.phone)}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}\nNotes: ${notes || 'none'}`
      );
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
