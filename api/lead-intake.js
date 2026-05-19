const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, gym_access, schedule, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, training_experience, gym_access,
      schedule, current_weight, target_weight, height
    };

    const { error: metaError } = await supabase
      .from('leads')
      .update({ first_msg: JSON.stringify(intakeData) })
      .eq('id', lead_id);

    if (metaError) console.error('Intake metadata save error:', metaError.message);

    const hasEscalation = checkIntakeEscalation(injuries, medical_conditions);
    if (hasEscalation) {
      const { escalate } = require('./_lib/escalation');
      await escalate(lead.phone, 'medical_flag_intake', `Injuries: ${injuries}, Medical: ${medical_conditions}`);
    }

    const leadPhone = phone || lead.phone;
    if (leadPhone) {
      await sendWhatsApp(leadPhone, 'intake_received', [
        name,
        'Your details have been received. Maddy will review and your program will be ready soon!'
      ]);
    }

    return res.json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkIntakeEscalation(injuries, medicalConditions) {
  const combined = ((injuries || '') + ' ' + (medicalConditions || '')).toLowerCase();
  const flags = ['surgery', 'pregnant', 'heart', 'diabetes', 'thyroid', 'spinal', 'hernia', 'epilepsy'];
  return flags.some(f => combined.includes(f));
}
