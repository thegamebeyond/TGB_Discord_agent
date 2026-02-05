import { Client, GatewayIntentBits, Events } from "discord.js";
import OpenAI from "openai";

const DISCORD_BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || "").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const VECTOR_STORE_ID = (process.env.VECTOR_STORE_ID || "").trim();
const TA_CHANNEL_ID = (process.env.TA_CHANNEL_ID || "").trim();

if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

console.log("VECTOR_STORE_ID raw:", JSON.stringify(process.env.VECTOR_STORE_ID || ""));
console.log("VECTOR_STORE_ID length:", (process.env.VECTOR_STORE_ID || "").length);

if (!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");
if (!TA_CHANNEL_ID) throw new Error("Missing TA_CHANNEL_ID");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // needed to read message text
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📚 Vector store: ${VECTOR_STORE_ID}`);
  console.log(`🧑‍🏫 TA channel lock: ${TA_CHANNEL_ID}`);
});

console.log("MSG:", message.channelId, message.author.username, message.content?.slice(0, 50));


client.on(Events.MessageCreate, async (message) => {
  try {
    // Ignore bots (including itself)
    if (message.author.bot) return;

    // Only respond in the TA channel
    if (message.channelId !== TA_CHANNEL_ID) return;

    const content = (message.content || "").trim();

    // Simple trigger: "ta: ..."
    if (!content.toLowerCase().startsWith("ta:")) return;

    const question = content.slice(3).trim();
    if (!question) return;

    // Optional: show typing indicator
    await message.channel.sendTyping();

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are the Game Beyond TA for the Game Design Basics course. " +
            "Answer ONLY using the provided curriculum files. " +
            "If the answer is not found in the curriculum, say you don't have that covered yet and suggest what lesson/module the student should review if possible. " +
            "Keep answers concise and practical.",
        },
        { role: "user", content: question },
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [VECTOR_STORE_ID],
        },
      ],
    });

    const answer = response.output_text?.trim() || "I couldn’t generate an answer.";

    // Discord message limit is 2000 chars. Trim safely.
    const safeAnswer = answer.length > 1900 ? answer.slice(0, 1900) + "…" : answer;

    await message.reply(safeAnswer);
  } catch (err) {
    console.error("❌ Handler error:", err);
    // Keep user-facing errors minimal
    try {
      await message.reply("Something went wrong while answering. Try again in a moment.");
    } catch {}
  }
});

client.login(DISCORD_BOT_TOKEN);
