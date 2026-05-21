const { getSupabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/escalation');
const { notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level
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

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const esc = needsEscalation(intakeText);
    if (esc.escalate) {
      await notifyMaddy(
        `Intake form escalation for ${maskPhone(lead.phone)}`,
        `Name: ${name}\nKeyword: "${esc.reason}"\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_pref, schedule, medical_conditions,
      current_weight, target_weight, experience_level,
      submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
