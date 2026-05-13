const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await getSupabase()
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    await getSupabase()
      .from('leads')
      .update({
        ...updates,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      email, age, gender, goal, injuries,
      diet_pref, schedule, medical_conditions,
      current_weight, height,
      submitted_at: new Date().toISOString()
    };

    const { error: storageErr } = await getSupabase().storage
      .from('intake-forms')
      .upload(
        `${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) {
      console.error('Storage error:', storageErr.message);
    }

    const hasEscalation = [injuries, medical_conditions].some(
      field => field && /injury|surgery|pregnant|medication|heart|diabetes/i.test(field)
    );

    if (hasEscalation) {
      const { notifyMaddy } = require('./_lib/whatsapp');
      await notifyMaddy(
        'Intake form — medical flag',
        `Lead: ${name || lead.phone}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
