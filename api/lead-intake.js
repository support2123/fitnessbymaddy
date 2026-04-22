const { getSupabase } = require('../lib/supabase');
const { needsEscalation, parseBody, cors } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, phone, age, goal,
      injuries, diet_pref, schedule, experience
    } = body;

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
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeText = [injuries, goal, diet_pref].filter(Boolean).join(' ');
    if (needsEscalation(intakeText)) {
      await escalate('Intake form flagged', lead.phone, intakeText.slice(0, 300));
    }

    await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || goal || null
    }).eq('id', lead.id);

    return res.status(200).json({
      ok: true,
      lead_id: lead.id,
      message: 'Intake form saved. You will be onboarded once payment is confirmed.'
    });
  } catch (err) {
    console.error('[Lead Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
