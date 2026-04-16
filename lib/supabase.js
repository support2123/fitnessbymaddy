import { createClient } from '@supabase/supabase-js';

let _client = null;

export function supa() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _client;
}

export async function logMessage({ phone, direction, body, template_name, status }) {
  try {
    await supa().from('messages').insert({
      phone, direction, body: body || null,
      template_name: template_name || null,
      status: status || null
    });
  } catch (e) {
    // Never let audit failures break flow.
    console.error('logMessage failed', e.message);
  }
}

export async function getLeadByPhone(phone) {
  const { data } = await supa()
    .from('leads').select('*').eq('phone', phone).maybeSingle();
  return data;
}

export async function upsertLead(lead) {
  const { data, error } = await supa()
    .from('leads').upsert(lead, { onConflict: 'phone' }).select().single();
  if (error) throw error;
  return data;
}

export async function updateLead(id, patch) {
  const { data, error } = await supa()
    .from('leads').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function getClientByPhone(phone) {
  const { data } = await supa()
    .from('clients').select('*').eq('phone', phone)
    .eq('status', 'active').maybeSingle();
  return data;
}

export async function getLastOutbound(phone, withinMs) {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data } = await supa()
    .from('messages').select('id, sent_at')
    .eq('phone', phone).eq('direction', 'out')
    .gte('sent_at', since).limit(1).maybeSingle();
  return data;
}
