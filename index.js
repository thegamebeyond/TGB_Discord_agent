import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import OpenAI from "openai";

const DISCORD_BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || "").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const VECTOR_STORE_ID = (process.env.VECTOR_STORE_ID || "").trim();
const TA_CHANNEL_ID = (process.env.TA_CHANNEL_ID || "").trim();
const GUILD_ID = (process.env.GUILD_ID || "").trim();

if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!VECTOR_STORE_ID) throw new Error("Missing VECTOR_STORE_ID");
if (!TA_CHANNEL_ID) throw new Error("Missing TA_CHANNEL_ID");
if (!GUILD_ID) throw new Error("Missing GUILD_ID");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
  intents: [GatewayIntentBits.Guilds], // slash commands only need Guilds
});

// --- Slash command definition ---
const askCommand = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the Game Beyond TA a question (Game Design Basics).")
  .addStringOption((opt) =>
    opt
      .setName("question")
      .setDescription("Your question")
      .setRequired(true)
  );

async function registerGuildCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: [askCommand.toJSON()],
  });

  console.log("✅ Registered /ask command for guild:", GUILD_ID);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`📚 Vector store: ${VECTOR_STORE_ID}`);
  console.log(`🧑‍🏫 TA channel lock: ${TA_CHANNEL_ID}`);
  console.log(`🏫 Guild: ${GUILD_ID}`);

  // Register slash command on startup (guild-only = instant)
  try {
    await registerGuildCommands();
  } catch (err) {
    console.error("❌ Failed to register slash command:", err);
  }
});

// --- Handle /ask ---
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "ask") return;

    // Only allow in the TA channel
    if (interaction.channelId !== TA_CHANNEL_ID) {
      await interaction.reply({
        content: "Please use /ask in the designated TA channel.",
        ephemeral: true,
      });
      return;
    }

    const question = interaction.options.getString("question", true).trim();

    // Acknowledge quickly (Discord requires response within ~3 seconds)
    await interaction.deferReply();

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "You are the Game Beyond TA for the Game Design Basics course. " +
            "Answer ONLY using the provided curriculum files. " +
            "If the answer is not found in the curriculum, say you don't have that covered yet. " +
            "Keep answers concise and practical.",
        },
        { role: "user", content: question },
      ],
      tools: [{ type: "file_search", vector_store_ids: [VECTOR_STORE_ID] }],
    });

    const answer = response.output_text?.trim() || "I couldn’t generate an answer.";
    const safeAnswer = answer.length > 1900 ? answer.slice(0, 1900) + "…" : answer;

    await interaction.editReply(safeAnswer);
  } catch (err) {
    console.error("❌ /ask error:", err);
    // If deferReply already happened, editReply; otherwise reply ephemeral
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("Something went wrong while answering. Try again.");
      } else {
        await interaction.reply({
          content: "Something went wrong while answering. Try again.",
          ephemeral: true,
        });
      }
    } catch {}
  }
});

client.login(DISCORD_BOT_TOKEN);
