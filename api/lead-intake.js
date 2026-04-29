const { getSupabase } = require('../lib/supabase');
const { normalizePhone } = require('../lib/phone');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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
      training_days,
      equipment_access,
      medical_conditions,
      current_weight,
      target_weight,
      schedule_preference
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(', ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag on intake form', {
        phone: phone || 'from_form',
        message: medicalText
      });
    }

    const updateData = { name };
    if (lead_id) {
      await db.from('leads').update(updateData).eq('id', lead_id);
    } else if (phone) {
      const normalized = normalizePhone(phone);
      await db.from('leads').update(updateData).eq('phone', normalized);
    }

    const intakeRecord = {
      lead_id: lead_id || null,
      name,
      email,
      phone: phone ? normalizePhone(phone) : null,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      training_days: training_days ? parseInt(training_days) : null,
      equipment_access: equipment_access || null,
      medical_conditions: medical_conditions || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      schedule_preference: schedule_preference || null,
      submitted_at: new Date().toISOString()
    };

    // Store as a JSONB column or separate table — using leads metadata for now
    if (lead_id) {
      const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
      if (lead) {
        await db.from('leads').update({
          name: name || lead.name,
          last_msg_at: new Date().toISOString()
        }).eq('id', lead_id);
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake form received' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
