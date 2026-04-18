const { getClient } = require('../lib/supabase');
const { cors, parseBody, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, experience } = body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
  }

  const db = getClient();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  // Update lead with intake data
  await db
    .from('leads')
    .update({
      name: name || lead.name,
    })
    .eq('id', lead_id);

  // Store intake data as a note in the lead record or in a separate structure
  // For now, we store the full intake in the client record when they convert
  // We'll keep this data in local storage and pass it through conversion

  console.log(`[INTAKE] ${maskPhone(lead.phone)} submitted intake form`);

  return res.status(200).json({
    success: true,
    message: 'Intake form received! Check your WhatsApp for next steps.',
    lead_id,
  });
};
