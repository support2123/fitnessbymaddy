const { supabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, phone, age, gender, height, weight,
    goal, injuries, diet_preference, schedule, medical_conditions,
    experience_level, equipment_access,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'Missing lead_id or phone' });
  }

  try {
    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Medical flag on intake form',
        `Phone: ${maskPhone(phone)}, Issues: ${medicalText.slice(0, 300)}`
      );
    }

    let leadQuery;
    if (lead_id) {
      leadQuery = supabase.from('leads').select('*').eq('id', lead_id).single();
    } else {
      leadQuery = supabase.from('leads').select('*').eq('phone', phone).single();
    }
    const { data: lead } = await leadQuery;

    if (lead) {
      await supabase.from('leads').update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);
    } else {
      await supabase.from('leads').insert({
        phone, name, source: 'intake_form', status: 'qualified',
      });
    }

    const intakeData = {
      name, email, phone, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level, equipment_access,
      submitted_at: new Date().toISOString(),
    };

    const leadId = lead?.id || lead_id;
    if (leadId) {
      await supabase.from('leads').update({
        first_msg: JSON.stringify(intakeData),
      }).eq('id', leadId);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
