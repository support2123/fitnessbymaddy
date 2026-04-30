const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/masking');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, current_weight, target_weight, height,
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'lead_id, name, and phone are required' });
    }

    const fullText = [goal, injuries, medical_conditions, diet_pref].filter(Boolean).join(' ');
    if (needsEscalation(fullText)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag on intake form',
        phone: maskPhone(phone),
        message: fullText.slice(0, 200),
      });
    }

    const db = getSupabase();

    await db.from('leads').update({
      name,
      status: 'qualified',
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ ok: true, message: 'Already onboarded' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('program_interest')
      .eq('id', lead_id)
      .single();

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      medical_conditions, experience_level,
      current_weight, target_weight, height,
    };

    await db.from('leads').update({
      first_msg: JSON.stringify(intakeData),
    }).eq('id', lead_id);

    await sendWhatsApp({
      phone,
      templateName: 'intake_received',
      bodyValues: [name],
    });

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('lead-intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
