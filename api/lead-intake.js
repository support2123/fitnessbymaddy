const supabase = require('../lib/supabase');
const { normalizePhone, detectMarket } = require('../lib/phone');
const { sendSessionMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, goal, injuries,
      diet_preference, schedule, equipment, medical_conditions
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const normalized = normalizePhone(phone);
      const { data } = await supabase.from('leads').select('*').eq('phone', normalized).single();
      lead = data;
    }

    if (!lead) {
      const normalized = normalizePhone(phone);
      const market = detectMarket(normalized);
      const { data: newLead } = await supabase.from('leads').insert({
        phone: normalized,
        name,
        source: 'intake_form',
        status: 'new',
        market
      }).select().single();
      lead = newLead;
    }

    const intakeData = {
      name: name || lead.name,
      email,
      age: parseInt(age) || null,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      equipment: equipment || null,
      medical_conditions: medical_conditions || null
    };

    await supabase.from('leads').update({
      name: intakeData.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    const { error: metaError } = await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[intake_form] ${JSON.stringify(intakeData)}`,
      status: 'received'
    });

    if (lead.program_interest) {
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.program_interest}`;
      await sendSessionMessage(lead.phone,
        `Thanks for filling the intake form, ${intakeData.name || 'there'}! 🙌\n\n` +
        `Your info helps us build the perfect plan for you.\n` +
        `Ready to start? Complete your checkout: ${checkoutUrl}`
      );
    }

    return res.status(200).json({ ok: true, lead_id: lead.id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
