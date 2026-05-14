const { supabase } = require('../lib/supabase');
const { detectMarket } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, phone, email, age, gender, goal, injuries,
      diet_preference, schedule, experience, current_weight,
      target_weight, height, lead_id,
    } = req.body;

    if (!phone && !lead_id) {
      return res.status(400).json({ error: 'phone or lead_id is required' });
    }

    const market = detectMarket(phone);

    if (lead_id) {
      await supabase.from('leads')
        .update({ name, last_msg_at: new Date().toISOString() })
        .eq('id', lead_id);
    } else {
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();

      if (existing) {
        await supabase.from('leads')
          .update({ name, last_msg_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('leads').insert({
          phone, name, source: 'intake_form', market,
        });
      }
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    const intakeData = {
      lead_id: lead?.id || lead_id,
      name, phone, email, age, gender, goal, injuries,
      diet_preference, schedule, experience,
      current_weight, target_weight, height,
      submitted_at: new Date().toISOString(),
    };

    const { error: storageErr } = await supabase.storage
      .from('clients')
      .upload(
        `intake/${lead?.id || lead_id || phone}.json`,
        JSON.stringify(intakeData),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) {
      console.error('Storage upload failed:', storageErr.message);
    }

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
