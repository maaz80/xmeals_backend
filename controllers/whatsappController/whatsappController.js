import { supabase } from "../../config/supbase.js";

// 📌 For webhook verification (GET)
export const verifyWebhook = (req, res) => {
     console.log('query:', req.query);
     console.log('env token:', process.env.WHATSAPP_VERIFY_TOKEN);
     const mode = req.query["hub.mode"];
     const challenge = req.query["hub.challenge"];
     const token = req.query["hub.verify_token"];

     if (mode && token === process.env.WHATSAPP_VERIFY_TOKEN) {
          return res.status(200).send(challenge);
     }

     return res.sendStatus(403);
};

// 📌 Vendor clicks ACCEPT button (POST)
export const whatsappWebhook = async (req, res) => {
     try {
          const data = req.body;

          // extract button payload
          const buttonReply =
               data?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.interactive?.button_reply;

          if (!buttonReply) return res.sendStatus(200);

          const payload = buttonReply.id; // "ACCEPT_ORDER:<order_id>"
          const [action, order_id] = payload.split(":");

          if (action !== "ACCEPT_ORDER") return res.sendStatus(200);

          // Update order status
          const { error: updateErr } = await supabase
               .from("orders")
               .update({
                    status: "accepted",
                    accepted_ts: new Date()
               })
               .eq("order_id", order_id);

          if (updateErr) throw updateErr;

          return res.status(200).json({ success: true });

     } catch (err) {
          console.error("Whatsapp webhook error:", err);
          return res.status(500).json({ error: err.message });
     }
};
