const { getSupabase } = require('../lib/supabase');
const { needsEscalation, maskPhone } = require('../lib/helpers');
const { sendWhatsApp } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      phone,
      email,
      age,
      gender,
      goal,
      current_weight,
      target_weight,
      height,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      available_equipment,
      weekly_schedule,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const db = getSupabase();

    const { data: intake, error } = await db.from('intake_forms').insert({
      lead_id: lead_id || null,
      name,
      phone,
      email,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height: height ? parseFloat(height) : null,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      available_equipment,
      weekly_schedule,
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save form' });
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead_id);
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await db.from('escalations').insert({
        phone: phone || 'unknown',
        lead_id: lead_id || null,
        reason: 'medical_flag_intake',
        message: `Injuries: ${injuries || 'none'} | Conditions: ${medical_conditions || 'none'}`,
        status: 'pending',
      });

      const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
      await sendWhatsApp(maddyPhone, 'escalation_alert', [
        `INTAKE FLAG: ${name} reported medical concerns. Review intake form.`,
      ]);
    }

    return res.status(200).json({ success: true, id: intake.id });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
