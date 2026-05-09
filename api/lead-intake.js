const { getSupabase } = require('./lib/supabase');
const { sendText, notifyMaddy, detectMarket, isHinglish, maskPhone, checkEscalation } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, workout_schedule,
      medical_conditions, current_fitness_level, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    const db = getSupabase();

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeData = {
      name, email, age, gender, height, weight, goal,
      injuries, diet_preference, workout_schedule,
      medical_conditions, current_fitness_level
    };

    // Store intake data as a message for audit trail
    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const escalationFields = [injuries, medical_conditions, goal].join(' ');
    const escalation = checkEscalation(escalationFields);
    if (escalation) {
      await notifyMaddy(`Intake form escalation: "${escalation}"`, {
        phone: maskPhone(lead.phone),
        message: `Client ${name || 'Unknown'} reported: ${escalation}. Details: ${escalationFields.substring(0, 200)}`
      });
    }

    const market = detectMarket(lead.phone);
    const hinglish = isHinglish(market);

    const confirmMsg = hinglish
      ? `Thanks ${name || ''}! 🎉 Tumhari details mil gayi. Jaise hi payment confirm hogi, program start ho jayega. Questions ho toh yahan puch lo!`
      : `Thanks ${name || ''}! 🎉 We've received your details. Your program will start as soon as payment is confirmed. Feel free to ask questions!`;

    await sendText(lead.phone, confirmMsg);

    return res.status(200).json({ status: 'ok', message: 'Intake form received' });
  } catch (err) {
    console.error('Intake form error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
