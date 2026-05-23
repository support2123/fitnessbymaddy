const { getSupabase } = require("./lib/supabase");
const {
  normalizePhone,
  detectMarket,
  sendWhatsApp,
  maskPhone,
} = require("./lib/whatsapp");
const { logMessage, canSendMessage } = require("./lib/messages");
const { needsEscalation, escalateToMaddy } = require("./lib/escalation");

const PROGRAM_ROUTES = {
  fat_loss: {
    keywords: ["fat loss", "weight loss", "weight", "shred", "lean", "slim"],
    program: "6wk_gym",
    name: "6-Week Burn & Build",
    price: "$97",
  },
  pcos: {
    keywords: ["pcos", "hormonal", "hormone", "irregular period"],
    program: "pcos",
    name: "PCOS Warrior Program",
    price: "$45",
  },
  forty_plus: {
    keywords: ["40", "forty", "menopause", "joints", "senior"],
    program: "40plus",
    name: "40+ Strong Program",
    price: "$50",
  },
  flagship: {
    keywords: ["custom", "12 week", "12-week", "serious", "premium"],
    program: "12wk",
    name: "12-Week Custom Training",
    price: "$200",
  },
  trial: {
    keywords: ["trial", "zoom", "not sure", "try", "test"],
    program: "zoom_trial",
    name: "Zoom Trial Session",
    price: "$20",
  },
};

function routeProgram(message) {
  const lower = (message || "").toLowerCase();
  for (const [, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some((kw) => lower.includes(kw))) return route;
  }
  return null;
}

function isOptOut(message) {
  const lower = (message || "").toLowerCase().trim();
  return ["stop", "unsubscribe", "opt out", "optout", "cancel"].includes(
    lower
  );
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = normalizePhone(
      payload.phone || payload.from || payload.waId || ""
    );
    const message = payload.text || payload.body || payload.message || "";
    const name = payload.name || payload.pushName || "";

    if (!phone) return res.status(400).json({ error: "No phone number" });

    await logMessage(phone, "in", message, null);

    if (isOptOut(message)) {
      await db
        .from("leads")
        .update({ status: "dropped" })
        .eq("phone", phone);
      console.log(`[OPT-OUT] ${maskPhone(phone)}`);
      return res.json({ action: "opted_out" });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        "Sensitive keyword detected",
        phone,
        message
      );
    }

    const { data: existingLead } = await db
      .from("leads")
      .select("*")
      .eq("phone", phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db
        .from("leads")
        .insert({
          phone,
          name,
          source: "whatsapp",
          status: "new",
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const template =
        market === "IN" ? "welcome_v1_hindi" : "welcome_v1";
      await sendWhatsApp(phone, template, {
        name: name || "there",
        templateParams: [name || "there"],
      });
      await logMessage(phone, "out", "Welcome message sent", template);

      return res.json({ action: "new_lead", lead_id: lead?.id });
    }

    if (existingLead.status === "dropped") {
      return res.json({ action: "dropped_lead_ignored" });
    }

    await db
      .from("leads")
      .update({ last_msg_at: new Date().toISOString() })
      .eq("id", existingLead.id);

    const route = routeProgram(message);
    if (route && existingLead.status === "new") {
      await db
        .from("leads")
        .update({
          status: "qualified",
          program_interest: route.program,
        })
        .eq("id", existingLead.id);

      if (await canSendMessage(phone)) {
        const market = existingLead.market || detectMarket(phone);
        const lang = market === "IN" ? "hinglish" : "en";
        const checkoutMsg =
          lang === "hinglish"
            ? `Great choice! ${route.name} (${route.price}) ke liye yaha se enroll karo 👇\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${route.program}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
            : `Great choice! Enroll for ${route.name} (${route.price}) here 👇\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${route.program}\n\nPlease fill out the intake form too: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, "program_checkout", {
          name: existingLead.name || "there",
          templateParams: [
            existingLead.name || "there",
            route.name,
            route.price,
          ],
        });
        await logMessage(phone, "out", checkoutMsg, "program_checkout");
      }

      return res.json({
        action: "qualified",
        program: route.program,
      });
    }

    return res.json({ action: "message_logged" });
  } catch (err) {
    console.error("[WEBHOOK ERROR]", err.message);
    return res.status(500).json({ error: "Internal error" });
  }
};
