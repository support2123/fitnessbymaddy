import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Escalation id required' });

  const { error } = await supabase
    .from('escalations')
    .update({ resolved: true })
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}
