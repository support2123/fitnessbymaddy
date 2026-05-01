const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { cors, detectMarket } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body;
    const {
      name, phone, email, age, gender, goal,
      injuries, diet_preference, schedule,
      current_weight, target_weight, experience_level,
      lead_id
    } = body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'Phone or lead_id required' });
    }

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      schedule, current_weight, target_weight, experience_level
    };

    if (lead_id) {
      const { data: lead } = await db
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();

      if (lead) {
        await db.from('leads').update({
          name: name || lead.name,
          last_msg_at: new Date().toISOString()
        }).eq('id', lead.id);

        const { data: existingClient } = await db
          .from('clients')
          .select('id')
          .eq('lead_id', lead.id)
          .single();

        if (existingClient) {
          await db.from('clients').update({
            name: name || lead.name,
            email,
            intake_data: intakeData
          }).eq('id', existingClient.id);
        }
      }
    } else {
      const market = detectMarket(phone);
      const { data: existing } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();

      if (existing) {
        await db.from('leads').update({
          name,
          last_msg_at: new Date().toISOString()
        }).eq('id', existing.id);
      } else {
        await db.from('leads').insert({
          phone, name, source: 'intake_form',
          status: 'qualified', market
        });
      }
    }

    if (phone) {
      await sendTemplate(phone, 'intake_received', [name || 'there']);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
