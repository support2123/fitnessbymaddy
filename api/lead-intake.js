const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, maskPhone } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      schedule, equipment, experience_level, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      intake_data: {
        email, age, gender, goal, injuries, medical_conditions,
        diet_preference, schedule, equipment, experience_level,
        current_weight, target_weight, height,
        submitted_at: new Date().toISOString()
      }
    }).eq('id', lead_id);

    const combinedText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const esc = needsEscalation(combinedText);
    if (esc.escalate) {
      await notifyMaddy(
        'Intake Form Escalation',
        `Lead: ${maskPhone(phone || lead.phone)}\nName: ${name}\nTriggers: ${esc.reasons.join(', ')}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
