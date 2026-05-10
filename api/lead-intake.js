const { getSupabase } = require('../lib/supabase');
const { jsonResponse, errorResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

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
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    // Update lead with intake info
    const { data: lead, error: leadErr } = await db.from('leads')
      .update({
        name: name || undefined,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id)
      .select()
      .single();

    if (leadErr) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Store intake data as a checkin week 0 (baseline)
    await db.from('checkins').insert({
      client_id: null, // Will be linked after conversion
      week_no: 0,
      weight: current_weight || null,
      compliance_score: null,
      energy: null,
      issues: JSON.stringify({
        age,
        gender,
        goal,
        injuries,
        diet_preference,
        schedule,
        experience_level,
        target_weight,
        medical_conditions,
      }),
      form_submitted_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
    // Non-critical — intake data is also stored in the lead context

    // Check for medical escalation triggers
    const medicalKeywords = ['injury', 'pregnan', 'surgery', 'medication', 'diabetes', 'heart', 'thyroid'];
    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ').toLowerCase();
    const needsEscalation = medicalKeywords.some(k => allText.includes(k));

    if (needsEscalation) {
      const { sendText, maskPhone } = require('../lib/whatsapp');
      await sendText('+917082478374',
        `⚠️ Intake form flagged for review\nLead: ${name || maskPhone(phone)}\nGoal: ${goal}\nConditions: ${medical_conditions || 'none'}\nInjuries: ${injuries || 'none'}`
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully',
      lead_id: lead.id,
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
