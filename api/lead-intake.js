const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, needsEscalation, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders()).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, phone, email, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level,
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(', ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag on intake form', phone, medicalText);
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        program_interest: goal || null,
        status: 'qualified',
      }).eq('id', lead_id);
    } else {
      await db.from('leads').upsert({
        phone,
        name,
        source: 'intake_form',
        status: 'qualified',
        program_interest: goal || null,
        market,
      }, { onConflict: 'phone' });
    }

    const template = isHinglish(market) ? 'intake_received_hi' : 'intake_received_en';
    await sendWhatsApp(phone, template, [name]);

    res.set(corsHeaders());
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
