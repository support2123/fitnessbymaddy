const { getClient } = require('../lib/supabase');
const { needsEscalation, escalateMessage } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getClient();

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateMessage(
        phone || 'unknown',
        medicalText,
        'Medical/injury flag on intake form'
      );
    }

    let leadId = lead_id;

    if (lead_id) {
      await db
        .from('leads')
        .update({ name, program_interest: goal })
        .eq('id', lead_id);
    } else if (phone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();

      if (lead) {
        leadId = lead.id;
        await db.from('leads').update({ name }).eq('id', lead.id);
      }
    }

    const intakeData = {
      lead_id: leadId,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await db.from('intake_forms').upsert(intakeData, {
      onConflict: 'lead_id',
      ignoreDuplicates: false,
    });

    if (error) {
      const { error: insertErr } = await db.from('intake_forms').insert(intakeData);
      if (insertErr) {
        console.error('Intake save error:', insertErr.message);
      }
    }

    return res.status(200).json({ success: true, lead_id: leadId });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
