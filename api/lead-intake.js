const { getSupabase } = require('../lib/supabase');

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
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    const db = getSupabase();

    let leadQuery;
    if (lead_id) {
      leadQuery = db.from('leads').select('*').eq('id', lead_id).single();
    } else {
      leadQuery = db.from('leads').select('*').eq('phone', phone).single();
    }

    const { data: lead, error: leadErr } = await leadQuery;
    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    // Store intake data as a message for audit
    const intakeData = JSON.stringify({
      age, gender, goal, injuries, medical_conditions,
      diet_preference, schedule, experience_level,
      current_weight, target_weight, height
    });

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `INTAKE FORM: ${intakeData}`.slice(0, 500),
      template_name: 'intake_form',
      sent_at: new Date().toISOString()
    });

    // Check for medical escalation
    const flagged = [injuries, medical_conditions].filter(Boolean).join(' ').toLowerCase();
    const needsReview = ['injury', 'pregnant', 'surgery', 'hernia', 'heart', 'diabetes', 'medication']
      .some(kw => flagged.includes(kw));

    if (needsReview) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Medical flag in intake form',
        `Lead: ${name || lead.phone}\nConditions: ${medical_conditions || 'N/A'}\nInjuries: ${injuries || 'N/A'}`
      );
    }

    return res.status(200).json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
