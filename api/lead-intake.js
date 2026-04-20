const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { escalateIfNeeded } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      schedule, current_activity, experience_level
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const medicalConcern = injuries || medical_conditions;
    if (medicalConcern) {
      await escalateIfNeeded(
        lead.phone,
        `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`,
        'Intake form submission'
      );
    }

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, schedule, current_activity, experience_level
    };

    // Store as metadata in lead's first_msg (augment)
    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    await sendTemplate(lead.phone, 'intake_received', [
      name || lead.name || 'there',
      "Form received! We're reviewing your details. You'll get your program info shortly."
    ]);

    return res.status(200).json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
