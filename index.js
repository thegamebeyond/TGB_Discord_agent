import { Client, GatewayIntentBits, Events } from "discord.js";
import OpenAI from "openai";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");
if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
});

console.log("DISCORD_BOT_TOKEN set:", Boolean(process.env.DISCORD_BOT_TOKEN));
console.log("DISCORD_BOT_TOKEN length:", process.env.DISCORD_BOT_TOKEN?.length ?? 0);

client.login(DISCORD_BOT_TOKEN);
