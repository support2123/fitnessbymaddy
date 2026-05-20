const { supabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, gender, phone, email,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_weight, height,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Intake form: medical flag',
        `Lead: ${maskPhone(phone || 'unknown')}\nConditions: ${medicalText}`
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
    } else if (phone) {
      await supabase.from('leads').insert({
        phone, name, source: 'intake_form',
        status: 'new', market: 'GLOBAL',
      });
    }

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      schedule, medical_conditions, current_weight, height, email,
    };

    await supabase.from('messages').insert({
      phone: phone || 'form',
      direction: 'in',
      body: `Intake form: ${JSON.stringify(intakeData)}`,
    });

    return res.json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Intake processing failed' });
  }
};
