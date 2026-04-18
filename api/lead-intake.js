const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_preference, schedule, current_activity, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updateData = {};
    if (name) updateData.name = name;

    const intakeNotes = JSON.stringify({
      email, age, gender, goal, injuries,
      diet_preference, schedule, current_activity,
      submitted_at: new Date().toISOString(),
    });

    updateData.first_msg = lead.first_msg
      ? `${lead.first_msg}\n\n[INTAKE] ${intakeNotes}`
      : `[INTAKE] ${intakeNotes}`;

    await supabase
      .from('leads')
      .update(updateData)
      .eq('id', lead.id);

    if (lead.status === 'qualified' && lead.program_interest) {
      await sendTemplate(lead.phone, 'intake_received', [
        name || lead.name || 'there',
      ]);
    }

    return res.status(200).json({
      ok: true,
      lead_id: lead.id,
      message: 'Intake form received',
    });
  } catch (err) {
    console.error('[lead-intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
