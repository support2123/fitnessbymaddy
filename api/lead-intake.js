const { supabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { needsEscalation, maskPhone, parseBody, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, phone
    } = body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead.id);
    }

    const intakeData = {
      name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, submitted_at: new Date().toISOString()
    };

    const escalationFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationFields)) {
      await notifyMaddy(
        'Intake Form — Medical Flag',
        `Lead: ${name || maskPhone(lead.phone)}\nInjuries: ${injuries || 'None'}\nMedical: ${medical_conditions || 'None'}\nGoal: ${goal || 'N/A'}`
      );
    }

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${JSON.stringify(intakeData)}`,
      template_name: 'intake_form'
    });

    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Lead intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
