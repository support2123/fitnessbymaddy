const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./lib/market');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    } else {
      const { data: existing } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();

      if (!existing) {
        await db.from('leads').insert({
          phone,
          name,
          source: 'intake_form',
          status: 'qualified',
          market
        });
      }
    }

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .single();

      if (!existingClient) {
        await db.from('clients').insert({
          lead_id: lead.id,
          phone,
          name,
          email,
          status: 'active'
        });
      } else {
        await db.from('clients').update({ name, email }).eq('id', existingClient.id);
      }
    }

    const templateName = isHinglishMarket(market) ? 'intake_received_hi' : 'intake_received';
    await sendTemplate(phone, templateName, {
      name,
      templateParams: [name]
    });

    return res.status(200).json({ ok: true, message: 'Intake received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
