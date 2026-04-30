const { supabase } = require('./_lib/supabase');
const { needsEscalation, notifyMaddy } = require('./_lib/escalation');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, workout_location
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await notifyMaddy('Intake form flagged for review', {
        lead_id,
        name,
        injuries,
        medical_conditions,
        goal
      }, sendWhatsApp);
    }

    const cleanPhone = (phone || lead.phone || '').replace(/[^0-9]/g, '');
    if (cleanPhone) {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', cleanPhone)
        .limit(1);

      if (!existingClient || existingClient.length === 0) {
        const program = lead.program_interest || '6wk_gym';
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + (program === '12wk' ? 84 : 42));

        await supabase.from('clients').insert({
          lead_id: lead.id,
          phone: cleanPhone,
          name: name || lead.name,
          email,
          program,
          program_ends_at: endDate.toISOString(),
          status: 'active'
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Intake received' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
