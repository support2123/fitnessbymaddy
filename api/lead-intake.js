const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    const intakeData = { age, goal, injuries, diet_preference, schedule, medical_conditions };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `INTAKE FORM: ${JSON.stringify(intakeData)}`,
      template_name: 'intake_form',
    });

    if (medical_conditions && medical_conditions.trim()) {
      const { notifyMaddy } = require('./_lib/escalation');
      await notifyMaddy('Medical condition on intake form', {
        clientName: name,
        phone: lead.phone,
        message: medical_conditions,
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[lead-intake]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
