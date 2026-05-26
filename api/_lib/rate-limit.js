const { getSupabase } = require("./supabase");

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

async function canSendMessage(phone) {
  try {
    const supabase = getSupabase();
    const twoHoursAgo = new Date(Date.now() - TWO_HOURS_MS).toISOString();

    const { data } = await supabase
      .from("messages")
      .select("sent_at")
      .eq("phone", phone)
      .eq("direction", "out")
      .gte("sent_at", twoHoursAgo)
      .limit(1);

    return !data || data.length === 0;
  } catch {
    return true;
  }
}

module.exports = { canSendMessage };
