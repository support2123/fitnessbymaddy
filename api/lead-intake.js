const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, email, phone, age, gender, goal, injuries,
      diet_preference, schedule, current_weight, target_weight,
      experience_level, lead_id
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const db = getSupabase();

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      current_weight: current_weight || null,
      target_weight: target_weight || null,
      experience_level: experience_level || null
    };

    if (existingClient) {
      await db.from('clients').update({
        name,
        email,
        intake_data: intakeData
      }).eq('id', existingClient.id);
    } else {
      const market = detectMarket(phone);
      await db.from('leads').upsert({
        phone,
        name,
        source: 'intake_form',
        status: 'qualified',
        market,
        last_msg_at: new Date().toISOString(),
        created_at: new Date().toISOString()
      }, { onConflict: 'phone' });
    }

    const market = detectMarket(phone);
    if (isHinglish(market)) {
      await sendTemplate(phone, 'intake_received_hi', [name]);
    } else {
      await sendTemplate(phone, 'intake_received_en', [name]);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
