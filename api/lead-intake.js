const { getClient } = require('./lib/supabase');
const { cors, parseBody, normalizePhone, checkEscalation, maskPhone } = require('./lib/helpers');
const { notifyMaddy } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    } = body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getClient();
    let lead;

    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const normalized = normalizePhone(phone);
      const { data } = await db.from('leads').select('*').eq('phone', normalized).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const escalation = checkEscalation(
      [injuries, medical_conditions, goal].filter(Boolean).join(' ')
    );
    if (escalation.shouldEscalate) {
      await notifyMaddy(
        'Intake Form — Medical Flag',
        `Lead: ${name || maskPhone(lead.phone)}\nTriggers: ${escalation.triggers.join(', ')}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_pref, schedule, experience, medical_conditions,
      current_weight, target_weight, height,
      submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    console.log(`[Intake] Form submitted for lead ${maskPhone(lead.phone)}`);
    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
