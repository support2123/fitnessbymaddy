const supabase = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone, detectMarket } = require('../lib/helpers');
const { corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name, phone, email, age, goal, injuries,
      diet_preference, schedule, experience, lead_id
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const market = detectMarket(phone);

    if (lead_id) {
      await supabase.from('leads').update({
        name,
        status: 'qualified',
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    } else {
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();

      if (existing) {
        await supabase.from('leads').update({
          name,
          status: 'qualified',
          last_msg_at: new Date().toISOString()
        }).eq('id', existing.id);
      } else {
        await supabase.from('leads').insert({
          phone, name, source: 'intake_form', status: 'qualified', market
        });
      }
    }

    const clientData = {
      phone, name, email,
      metadata: { age, goal, injuries, diet_preference, schedule, experience }
    };

    console.log(`[Intake] Form submitted: ${maskPhone(phone)} — ${name}`);

    await sendTemplate(phone, 'intake_received', [name]);

    return res.status(200).json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
