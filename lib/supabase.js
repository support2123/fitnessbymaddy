// lib/supabase.js  -  Supabase client + helper queries
// Uses the service-role key so RLS is bypassed in serverless functions.

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables"
  );
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// -------------------------------------------------------------------
// Helper: fetch a lead by phone number (returns null if not found)
// -------------------------------------------------------------------
async function getLeadByPhone(phone) {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// -------------------------------------------------------------------
// Helper: upsert a lead (insert or update by phone)
// -------------------------------------------------------------------
async function upsertLead(leadData) {
  // If a lead with this phone already exists, update it; otherwise insert.
  const existing = await getLeadByPhone(leadData.phone);

  if (existing) {
    const { data, error } = await supabase
      .from("leads")
      .update({
        ...leadData,
        last_msg_at: leadData.last_msg_at || new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...leadData,
      last_msg_at: leadData.last_msg_at || new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// -------------------------------------------------------------------
// Helper: get all active clients
// -------------------------------------------------------------------
async function getActiveClients() {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("status", "active")
    .order("program_started_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

// -------------------------------------------------------------------
// Helper: get a single client by id
// -------------------------------------------------------------------
async function getClient(id) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

// -------------------------------------------------------------------
// Helper: log an inbound or outbound message
// -------------------------------------------------------------------
async function logMessage(phone, direction, body, templateName = null) {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      phone,
      direction,
      body,
      template_name: templateName,
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  getLeadByPhone,
  upsertLead,
  getActiveClients,
  getClient,
  logMessage,
};
