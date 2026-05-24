const { getSupabase } = require('./lib/supabase');
const { sendText, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      name,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_days,
      equipment_access,
      wake_time,
      sleep_time,
      current_weight,
      target_weight,
      height
    } = req.body;

    const db = getSupabase();

    if (injuries || medical_conditions) {
      const combined = `${injuries || ''} ${medical_conditions || ''}`;
      if (needsEscalation(combined)) {
        await escalate('intake_form', `New client intake flagged - Lead ${lead_id}: ${combined.slice(0, 200)}`);
      }
    }

    if (lead_id) {
      await db.from('leads').update({
        name: name || undefined,
        intake_data: {
          age, gender, goal, injuries, medical_conditions,
          diet_preference, workout_days, equipment_access,
          wake_time, sleep_time, current_weight, target_weight, height
        }
      }).eq('id', lead_id);

      const { data: lead } = await db
        .from('leads')
        .select('phone, market')
        .eq('id', lead_id)
        .single();

      if (lead?.phone) {
        const market = lead.market || detectMarket(lead.phone);
        const msg = market === 'IN'
          ? 'Form received! ✅ Aapki details save ho gayi hain. Payment ke baad aapka program officially start hoga.'
          : 'Form received! ✅ Your details have been saved. Once payment is confirmed, your program officially begins.';
        await sendText(lead.phone, msg);
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
