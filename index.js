// index.js
import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import OpenAI from "openai";

// ===== Env Vars =====
const DISCORD_BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || "").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const TA_CHANNEL_ID = (process.env.TA_CHANNEL_ID || "").trim();
const GUILD_ID = (process.env.GUILD_ID || "").trim();

const VS_MASTERCLASS_GAME_DESIGN = (process.env.VS_MASTERCLASS_GAME_DESIGN || "").trim();
const VS_GAME_DESIGN_BASICS = (process.env.VS_GAME_DESIGN_BASICS || "").trim();
const VS_BONUS = (process.env.VS_BONUS || "").trim();

// ===== Required Checks =====
if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");
if (!TA_CHANNEL_ID) throw new Error("Missing TA_CHANNEL_ID");
if (!GUILD_ID) throw new Error("Missing GUILD_ID");
if (!VS_MASTERCLASS_GAME_DESIGN) throw new Error("Missing VS_MASTERCLASS_GAME_DESIGN");
if (!VS_GAME_DESIGN_BASICS) throw new Error("Missing VS_GAME_DESIGN_BASICS");
if (!VS_BONUS) throw new Error("Missing VS_BONUS");

// ===== Course Dropdown Options =====
const COURSE_OPTIONS = [
  {
    label: "Masterclass Game Design",
    value: "masterclass",
    vectorStoreId: VS_MASTERCLASS_GAME_DESIGN,
    systemHint: "You are the Game Beyond TA for the Masterclass Game Design course.",
  },
  {
    label: "Game Design Basics",
    value: "basics",
    vectorStoreId: VS_GAME_DESIGN_BASICS,
    systemHint: "You are the Game Beyond TA for the Game Design Basics course.",
  },
  {
    label: "Bonus",
    value: "bonus",
    vectorStoreId: VS_BONUS,
    systemHint: "You are the Game Beyond TA for the Bonus course materials.",
  },
];

// Safety check
for (const c of COURSE_OPTIONS) {
  if (!c.vectorStoreId) throw new Error(`Missing vector store ID for course: ${c.label}`);
}

// Store per-user course selection in memory
const userCourseSelection = new Map(); // userId -> course object

// ===== Clients =====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
  intents: [GatewayIntentBits.Guilds], // slash commands only need Guilds
});

// ===== Slash Command Definition =====
const askCommand = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the Game Beyond TA a question.")
  .addStringOption((opt) =>
    opt
      .setName("question")
      .setDescription("Your question (optional — pick a course first)")
      .setRequired(false)
  );

async function registerGuildCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: [askCommand.toJSON()],
  });

  console.log("✅ Registered /ask command for guild:", GUILD_ID);
}

// ===== Helpers =====
async function showCourseDropdown(interaction) {
  const select = new StringSelectMenuBuilder()
    .setCustomId("course_select")
    .setPlaceholder("Choose a course…")
    .addOptions(
      COURSE_OPTIONS.map((c) => ({
        label: c.label,
        value: c.value,
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);

  await interaction.reply({
    content: "Pick which course to search:",
    components: [row],
    ephemeral: true,
  });
}

// ===== Startup =====
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  console.log(`🧑‍🏫 TA channel lock: ${TA_CHANNEL_ID}`);
  console.log(`🏫 Guild: ${GUILD_ID}`);
  console.log("📚 Vector stores:");
  for (const course of COURSE_OPTIONS) {
    console.log(`   - ${course.label}: ${course.vectorStoreId}`);
  }

  try {
    await registerGuildCommands();
  } catch (err) {
    console.error("❌ Failed to register slash command:", err);
  }
});

// ===== Interaction Handling =====
client.on(Events.InteractionCreate, async (interaction) => {
  // ---- Dropdown selection ----
  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId !== "course_select") return;

      const selectedValue = interaction.values?.[0];
      const course = COURSE_OPTIONS.find((c) => c.value === selectedValue);

      if (!course) {
        await interaction.reply({ content: "Course not found.", ephemeral: true });
        return;
      }

      userCourseSelection.set(interaction.user.id, course);

      await interaction.reply({
        content: `✅ Course set to **${course.label}**.\nNow run \`/ask\` again and include your question.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("❌ course_select error:", err);
      try {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true });
      } catch {}
    }
    return;
  }

  // ---- Slash command /ask ----
  if (interaction.isChatInputCommand()) {
    try {
      if (interaction.commandName !== "ask") return;

      // Only allow in the TA channel
      if (interaction.channelId !== TA_CHANNEL_ID) {
        await interaction.reply({
          content: "Please use /ask in the designated TA channel teacher_assistant.",
          ephemeral: true,
        });
        return;
      }

      const questionRaw = interaction.options.getString("question");
      const question = (questionRaw || "").trim();

      const selectedCourse = userCourseSelection.get(interaction.user.id);

      // If no course selected yet OR no question provided, show dropdown
      if (!selectedCourse || !question) {
        await showCourseDropdown(interaction);
        return;
      }

      // Respond quickly (Discord expects response within ~3 seconds)
      await interaction.deferReply();

      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              `${selectedCourse.systemHint} ` +
              "Answer ONLY using the provided curriculum files for this course. " +
              "If the answer is not found in the curriculum, say you don't have that covered yet. " +
              "Keep answers concise and practical.",
          },
          { role: "user", content: question },
        ],
        tools: [
          {
            type: "file_search",
            vector_store_ids: [selectedCourse.vectorStoreId],
          },
        ],
      });

      const answer = response.output_text?.trim() || "I couldn’t generate an answer.";
      const safeAnswer = answer.length > 1900 ? answer.slice(0, 1900) + "…" : answer;

      await interaction.editReply(safeAnswer);
    } catch (err) {
      console.error("❌ /ask error:", err);
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
  }
});

client.login(DISCORD_BOT_TOKEN);
