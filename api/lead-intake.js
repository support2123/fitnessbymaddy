const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, schedule, experience, phone,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const supabase = getSupabase();

    let leadId = lead_id;
    if (!leadId && phone) {
      const { data } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();
      if (data) leadId = data.id;
    }

    if (leadId) {
      await supabase
        .from('leads')
        .update({
          name: name || undefined,
          status: 'qualified',
        })
        .eq('id', leadId);
    }

    const { data: client, error } = await supabase
      .from('clients')
      .upsert({
        lead_id: leadId,
        phone: phone || null,
        name,
        email,
        status: 'active',
        intake_data: { age, gender, goal, injuries, diet_pref, schedule, experience },
      }, { onConflict: 'lead_id' })
      .select()
      .single();

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    if (phone) {
      await sendWhatsApp(phone, 'intake_received', [name || 'there']);
    }

    return res.status(200).json({ status: 'saved', client_id: client?.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
