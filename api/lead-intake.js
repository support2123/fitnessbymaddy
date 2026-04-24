const { getSupabase } = require('./lib/supabase');
const { sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, notifyMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id,
    name,
    email,
    phone,
    age,
    gender,
    goal,
    injuries,
    diet_preference,
    schedule,
    experience,
    current_weight,
    target_weight,
    medical_conditions,
  } = req.body;

  if (!phone && !lead_id) {
    return res.status(400).json({ error: 'phone or lead_id is required' });
  }

  const db = getSupabase();

  try {
    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await notifyMaddy(
        'Medical flag on intake form',
        `Phone: ${maskPhone(phone)}\nInjuries: ${injuries || 'none'}\nConditions: ${medical_conditions || 'none'}`
      );
    }

    let lead;
    if (lead_id) {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .maybeSingle();
      lead = data;
    }

    if (!lead && phone) {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      lead = data;
    }

    const intakeData = {
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      medical_conditions,
    };

    if (lead) {
      await db
        .from('leads')
        .update({
          name: name || lead.name,
          last_msg_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('lead_id', lead.id)
        .maybeSingle();

      if (existingClient) {
        await db
          .from('clients')
          .update({ name: name || undefined, email: email || undefined })
          .eq('id', existingClient.id);
      }
    } else if (phone) {
      const market = detectMarket(phone);
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'intake_form',
          status: 'new',
          first_msg: `Intake form: ${goal || 'not specified'}`,
          market,
        })
        .select()
        .single();
      lead = newLead;
    }

    if (phone) {
      const market = detectMarket(phone);
      if (isHinglish(market)) {
        await sendText(
          phone,
          `Thanks ${name || ''}! 🙏 Form mil gaya hai. Hum jaldi se aapka customised plan banayenge. Stay tuned!`
        );
      } else {
        await sendText(
          phone,
          `Thanks ${name || ''}! Your intake form has been received. We'll prepare your customised plan shortly. Stay tuned!`
        );
      }
    }

    return res.status(200).json({ ok: true, lead_id: lead?.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
