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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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

// ===== Courses =====
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

// Store per-user course selection in memory
const userCourseSelection = new Map(); // userId -> course object

// ===== Clients =====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
  intents: [GatewayIntentBits.Guilds], // interactions only
});

// ===== Slash command: /ask (no args) =====
const askCommand = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask the Game Beyond TA (choose a course, then ask a question).");

async function registerGuildCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);

  // Clear existing commands to force UI refresh
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: [] });

  // Register command(s)
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
    body: [askCommand.toJSON()],
  });

  console.log("✅ Re-registered /ask command for guild:", GUILD_ID);
}

// ===== Helpers =====
function buildCourseDropdown() {
  return new StringSelectMenuBuilder()
    .setCustomId("course_select")
    .setPlaceholder("Choose a course…")
    .addOptions(
      COURSE_OPTIONS.map((c) => ({
        label: c.label,
        value: c.value,
      }))
    );
}

function buildQuestionModal(courseLabel) {
  const modal = new ModalBuilder()
    .setCustomId("ask_modal")
    .setTitle(`Ask: ${courseLabel}`);

  const input = new TextInputBuilder()
    .setCustomId("question")
    .setLabel("Your question")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
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

// ===== Interactions =====
client.on(Events.InteractionCreate, async (interaction) => {
  // 1) /ask => show course dropdown
  if (interaction.isChatInputCommand() && interaction.commandName === "ask") {
    try {
      if (interaction.channelId !== TA_CHANNEL_ID) {
        await interaction.reply({
          content: "Please use /ask in the designated TA channel (teacher_assistant).",
          ephemeral: true,
        });
        return;
      }

      const select = buildCourseDropdown();
      const row = new ActionRowBuilder().addComponents(select);

      await interaction.reply({
        content: "Pick which course to search:",
        components: [row],
        ephemeral: true,
      });
    } catch (err) {
      console.error("❌ /ask dropdown error:", err);
      try {
        await interaction.reply({
          content: "Something went wrong starting /ask. Try again.",
          ephemeral: true,
        });
      } catch {}
    }
    return;
  }

  // 2) dropdown selection => store course and show modal for question
  if (interaction.isStringSelectMenu() && interaction.customId === "course_select") {
    try {
      if (interaction.channelId !== TA_CHANNEL_ID) {
        await interaction.reply({
          content: "Please use /ask in the designated TA channel (teacher_assistant).",
          ephemeral: true,
        });
        return;
      }

      const selectedValue = interaction.values?.[0];
      const course = COURSE_OPTIONS.find((c) => c.value === selectedValue);

      if (!course) {
        await interaction.reply({
          content: "Course not found. Please run /ask again.",
          ephemeral: true,
        });
        return;
      }

      userCourseSelection.set(interaction.user.id, course);

      const modal = buildQuestionModal(course.label);
      await interaction.showModal(modal);
    } catch (err) {
      console.error("❌ course_select error:", err);
      try {
        await interaction.reply({
          content: "Something went wrong selecting the course. Try /ask again.",
          ephemeral: true,
        });
      } catch {}
    }
    return;
  }

  // 3) modal submit => answer using selected vector store
  if (interaction.isModalSubmit() && interaction.customId === "ask_modal") {
    try {
      if (interaction.channelId !== TA_CHANNEL_ID) {
        await interaction.reply({
          content: "Please use /ask in the designated TA channel (teacher_assistant).",
          ephemeral: true,
        });
        return;
      }

      const course = userCourseSelection.get(interaction.user.id);
      if (!course?.vectorStoreId) {
        await interaction.reply({
          content: "I lost your course selection. Please run /ask again.",
          ephemeral: true,
        });
        return;
      }

      const question = (interaction.fields.getTextInputValue("question") || "").trim();
      if (!question) {
        await interaction.reply({
          content: "Please enter a question. Try /ask again.",
          ephemeral: true,
        });
        return;
      }

      // Respond quickly (ephemeral)
      await interaction.reply({
        content: `Searching **${course.label}**…`,
        ephemeral: true,
      });

      const response = await openai.responses.create({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              `${course.systemHint} ` +
              "Answer ONLY using the provided curriculum files for this course. " +
              "If the answer is not found in the curriculum, say you don't have that covered yet. " +
              "Keep answers concise and practical.",
          },
          { role: "user", content: question },
        ],
        tools: [
          {
            type: "file_search",
            vector_store_ids: [course.vectorStoreId],
          },
        ],
      });

      const answer = response.output_text?.trim() || "I couldn’t generate an answer.";
      const safeAnswer = answer.length > 1900 ? answer.slice(0, 1900) + "…" : answer;

      await interaction.editReply(safeAnswer);
    } catch (err) {
      console.error("❌ ask_modal error:", err);
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
    return;
  }
});

client.login(DISCORD_BOT_TOKEN);
