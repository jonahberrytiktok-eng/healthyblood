// index.js - Interactive Discord Bot with Two N8N Webhooks (de-dupe for ALL steps)
import { Client, GatewayIntentBits, Partials, ActivityType, EmbedBuilder } from "discord.js";
import { fetch } from "undici";
import http from "node:http";

// ===== Environment Variables =====
const TOKEN = process.env.DISCORD_TOKEN;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // Single webhook for both selections
const CHANNEL_ID = process.env.CHANNEL_ID || null;

if (!TOKEN || !N8N_WEBHOOK_URL) {
  console.error("❌ Missing required environment variables");
  console.error("Required: DISCORD_TOKEN, N8N_WEBHOOK_URL");
  process.exit(1);
}

// ===== Discord Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// Store user conversation state (per instance)
const userStates = new Map();
// Prevent duplicate processing within short time window (per instance)
const recentlyProcessed = new Map();
// Track processed message IDs to prevent duplicate handling (per instance)
const processedMessages = new Set();

// ===== Avatar options (12) =====
const avatarOptions = [
  "STATIN SIDE-EFFECT STEVEN",
  "PRE-STATIN PATRICIA",
  "HEART DISEASE HEREDITARY HARRY",
  "SKEPTICAL SUPPLEMENT SARAH",
  "BIOHACKER BRAD",
  "CONCERNED WIFE WENDY",
  "TYPE 2 DIABETES DAVID,
  "FUNCTIONAL MEDICINE FIONA",
  "CORPORATE EXECUTIVE CARLOS",
  "POST-HEART-SCARE PAUL",
  "PREVENTIVE HEALTH HEATHER",
  "NATURAL HEALTH NATHAN"
];

// ===== Script format options (30) =====
const scriptOptions = [
  "Timeline",
  "UGC Mashup",
  "Problem/Solution",
  "Mythbusting",
  "Demonstration",
  "Comparison",
  "Lifestyle",
  "Testimonials",
  "Reaction Video",
  "Scroll Stopper",
  "Education",
  "How To",
  "Fix This",
  "Celebrity/Influencer",
  "Urgency/Scarcity",
  "Customer Journey",
  "3 Reasons Why",
  "Stats/Data",
  "Native Style",
  "Unboxing",
  "Challenge",
  "Behind The Scenes",
  "Founder Story",
  "VSL (Video Sales Letter)",
  "Street Interviews",
  "Blog",
  "Announcement",
  "Whiteboard",
  "Podcast Style",
  "Quiz/Assessment"
];

// Market sophistication levels
const sophisticationLevels = [
  "Level 1 – The \"New\" Market (First to Market)",
  "Level 2 – The \"Competition Enters\" Market",
  "Level 3 – The \"Crowded\" Market",
  "Level 4 – The \"Sophisticated\" Market",
  "Level 5 – The \"Hyper-Sophisticated\" Market"
];

// Video length options
const videoLengths = [
  "Micro/Hook (0:15-0:30) - 35-75 words",
  "Short Direct Response (0:45-1:00) - 100-150 words",
  "Medium-Length (1:30-2:00) - 200-300 words",
  "Long-Form (3-5 min) - 400-750 words"
];

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    status: "online",
    activities: [{ name: "for script requests", type: ActivityType.Watching }],
  });
});

// ===== Message Handler =====
client.on("messageCreate", async (msg) => {
  try {
    if (msg.author.bot) return;
    if (processedMessages.has(msg.id)) return;
    processedMessages.add(msg.id);
    if (processedMessages.size > 100) {
      const firstItem = processedMessages.values().next().value;
      processedMessages.delete(firstItem);
    }
    if (CHANNEL_ID && msg.channelId !== CHANNEL_ID) return;

    const userId = msg.author.id;
    const userState = userStates.get(userId);

    if (userState) {
      await handleConversationStep(msg, userState);
      return;
    }

    if (msg.mentions.has(client.user)) {
      const lastProcessed = recentlyProcessed.get(userId);
      if (lastProcessed && Date.now() - lastProcessed < 5000) return;
      if (userStates.has(userId)) return;

      recentlyProcessed.set(userId, Date.now());
      await startAvatarSelection(msg);
      setTimeout(() => recentlyProcessed.delete(userId), 10000);
    }

  } catch (err) {
    console.error("❌ Error handling message:", err);
    msg.reply("❌ Sorry, something went wrong! Please try again.").catch(console.error);
  }
});

/**
 * De-dupe any step prompt:
 *  - stepKey: "avatar" | "format" | "sophistication" | "length"
 *  - titleMatch: string in embed.title to identify that step’s menu
 * Keeps the earliest, deletes the rest (accepts legacy prompts without uid).
 */
async function dedupeStepPrompts(channel, userId, stepKey, titleMatch) {
  try {
    const recent = await channel.messages.fetch({ limit: 30 });
    const isStepPrompt = (m) => {
      if (!m.author.bot) return false;
      const e = m.embeds?.[0];
      if (!e) return false;
      const title = (e.title || "").toLowerCase();
      if (!title.includes(titleMatch.toLowerCase())) return false;
      if (Date.now() - m.createdTimestamp > 30_000) return false;
      const footer = (e.footer?.text || "");
      const hasUid = footer.includes(`uid:${userId}`) && footer.includes(`step:${stepKey}`);
      const looksLegacy = footer.startsWith("Reply with the number (1-") && !footer.includes("uid:");
      return hasUid || looksLegacy;
    };

    const candidates = recent
      .filter(isStepPrompt)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    if (candidates.size <= 1) {
      return { keptId: candidates.first()?.id || null, deleted: 0 };
    }

    const keep = candidates.first();
    let deleted = 0;
    for (const [, m] of candidates) {
      if (m.id === keep.id) continue;
      await m.delete().catch(() => null);
      deleted++;
    }
    console.log(`🧹 De-duped ${stepKey} prompts: kept ${keep.id}, deleted ${deleted}`);
    return { keptId: keep.id, deleted };
  } catch (e) {
    console.warn("dedupeStepPrompts warning:", e?.message || e);
    return { keptId: null, deleted: 0 };
  }
}

// Start the avatar selection process
async function startAvatarSelection(msg) {
  const userId = msg.author.id;
  if (userStates.has(userId)) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("📝 Please select an avatar for this script:")
    .setDescription(avatarOptions.map((avatar, i) => `**${i + 1}** ${avatar}`).join('\n'))
    .setFooter({ text: `Reply with the number (1-${avatarOptions.length}) to continue. • uid:${userId} • step:avatar` });

  const avatarMsg = await msg.reply({ embeds: [embed] });

  const { keptId } = await dedupeStepPrompts(msg.channel, userId, "avatar", "Please select an avatar for this script");
  if (keptId && keptId !== avatarMsg.id) {
    try { await avatarMsg.delete().catch(() => null); } catch {}
    return; // another instance owns the flow
  }

  userStates.set(userId, {
    step: 'avatar',
    channelId: msg.channelId,
    guildId: msg.guildId,
    selections: {},
    messagesToDelete: [avatarMsg.id],
    startedAt: Date.now()
  });

  setTimeout(() => {
    if (userStates.has(userId)) {
      userStates.delete(userId);
      msg.channel.send(`<@${userId}> Selection timed out. Please mention me again to restart.`).catch(console.error);
    }
  }, 300000);
}

// Handle each step of the conversation
async function handleConversationStep(msg, userState) {
  const selection = parseInt(msg.content.trim());
  if (userState.lastMessageId === msg.id) return;
  userState.lastMessageId = msg.id;

  if (userState.step === 'avatar') {
    if (isNaN(selection) || selection < 1 || selection > avatarOptions.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${avatarOptions.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    userState.selections.avatar = { number: selection, name: avatarOptions[selection - 1] };
    userState.messagesToDelete.push(msg.id);

    userState.step = 'format';
    await new Promise(r => setTimeout(r, 400));

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle("🎬 Now select a script format:")
      .setDescription(scriptOptions.map((script, i) => `**${i + 1}** ${script}`).join('\n'))
      .setFooter({ text: `Reply with the number (1-${scriptOptions.length}) to continue. • uid:${msg.author.id} • step:format` });

    const formatMsg = await msg.reply({ embeds: [embed] });

    const { keptId } = await dedupeStepPrompts(msg.channel, msg.author.id, "format", "Now select a script format");
    if (keptId && keptId !== formatMsg.id) {
      try { await formatMsg.delete().catch(() => null); } catch {}
      return;
    }
    userState.messagesToDelete.push(formatMsg.id);

  } else if (userState.step === 'format') {
    if (isNaN(selection) || selection < 1 || selection > scriptOptions.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${scriptOptions.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    userState.selections.format = { number: selection, name: scriptOptions[selection - 1] };
    userState.messagesToDelete.push(msg.id);

    userState.step = 'sophistication';
    await new Promise(r => setTimeout(r, 400));

    const sophisticationEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle("🎯 Select market sophistication level:")
      .setDescription(sophisticationLevels.map((level, i) => `**${i + 1}** ${level}`).join('\n\n'))
      .setFooter({ text: `Reply with the number (1-${sophisticationLevels.length}) to continue. • uid:${msg.author.id} • step:sophistication` });

    const sophisticationMsg = await msg.reply({ embeds: [sophisticationEmbed] });

    const { keptId } = await dedupeStepPrompts(msg.channel, msg.author.id, "sophistication", "Select market sophistication level");
    if (keptId && keptId !== sophisticationMsg.id) {
      try { await sophisticationMsg.delete().catch(() => null); } catch {}
      return;
    }
    userState.messagesToDelete.push(sophisticationMsg.id);

  } else if (userState.step === 'sophistication') {
    if (isNaN(selection) || selection < 1 || selection > sophisticationLevels.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${sophisticationLevels.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    userState.selections.sophistication = { number: selection, level: sophisticationLevels[selection - 1] };
    userState.messagesToDelete.push(msg.id);

    userState.step = 'length';
    await new Promise(r => setTimeout(r, 400));

    const lengthEmbed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle("⏱️ Select video length:")
      .setDescription(videoLengths.map((length, i) => `**${i + 1}** ${length}`).join('\n\n'))
      .setFooter({ text: `Reply with the number (1-${videoLengths.length}) to continue. • uid:${msg.author.id} • step:length` });

    const lengthMsg = await msg.reply({ embeds: [lengthEmbed] });

    const { keptId } = await dedupeStepPrompts(msg.channel, msg.author.id, "length", "Select video length");
    if (keptId && keptId !== lengthMsg.id) {
      try { await lengthMsg.delete().catch(() => null); } catch {}
      return;
    }
    userState.messagesToDelete.push(lengthMsg.id);

  } else if (userState.step === 'length') {
    if (isNaN(selection) || selection < 1 || selection > videoLengths.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${videoLengths.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    if (userState.processing) return;
    userState.processing = true;

    userState.selections.length = { number: selection, description: videoLengths[selection - 1] };
    userState.messagesToDelete.push(msg.id);

    const confirmEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle("✅ Your selections:")
      .addFields(
        { name: "Avatar", value: `${userState.selections.avatar.number}. ${userState.selections.avatar.name}`, inline: false },
        { name: "Format", value: `${userState.selections.format.number}. ${userState.selections.format.name}`, inline: false },
        { name: "Sophistication", value: `${userState.selections.sophistication.number}. ${userState.selections.sophistication.level}`, inline: false },
        { name: "Length", value: `${userState.selections.length.number}. ${userState.selections.length.description}`, inline: false }
      )
      .setFooter({ text: "Sending to workflow..." });

    const confirmMsg = await msg.reply({ embeds: [confirmEmbed] });
    userState.messagesToDelete.push(confirmMsg.id);

    const sent = await sendToN8N(msg, userState.selections);
    if (!sent) {
      await confirmMsg.edit({ content: "❌ Failed to submit request. Please try again.", embeds: [] });
      userStates.delete(msg.author.id);
      return;
    }

    const successEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle("🎉 Script request submitted!")
      .setDescription("Your script is being generated. You'll receive it shortly...")
      .addFields(
        { name: "Avatar", value: userState.selections.avatar.name, inline: true },
        { name: "Format", value: userState.selections.format.name, inline: true },
        { name: "Sophistication", value: userState.selections.sophistication.level, inline: false },
        { name: "Length", value: userState.selections.length.description, inline: false }
      )
      .setTimestamp();

    await msg.reply({ embeds: [successEmbed] });

    await cleanupMessages(msg.channel, userState.messagesToDelete);
    userStates.delete(msg.author.id);
  }
}

// Helper function to bulk delete messages
async function cleanupMessages(channel, messageIds) {
  try {
    if (messageIds.length === 0) return;
    if (messageIds.length === 1) {
      const message = await channel.messages.fetch(messageIds[0]).catch(() => null);
      if (message) await message.delete().catch(console.error);
    } else if (messageIds.length <= 100) {
      await channel.bulkDelete(messageIds, true).catch(async () => {
        for (const id of messageIds) {
          const message = await channel.messages.fetch(id).catch(() => null);
          if (message) await message.delete().catch(console.error);
        }
      });
    } else {
      for (let i = 0; i < messageIds.length; i += 100) {
        const chunk = messageIds.slice(i, i + 100);
        await channel.bulkDelete(chunk, true).catch(console.error);
      }
    }
  } catch (err) {
    console.error("Error cleaning up messages:", err);
  }
}

// Send all selections to N8N
async function sendToN8N(msg, selections) {
  const payload = {
    avatar: {
      data: { text: selections.avatar.number.toString() },
      name: selections.avatar.name
    },
    format: {
      data: { text: selections.format.number.toString() },
      name: selections.format.name
    },
    sophistication: {
      data: { text: selections.sophistication.number.toString() },
      level: selections.sophistication.level
    },
    length: {
      data: { text: selections.length.number.toString() },
      description: selections.length.description
    },
    discord: {
      user_id: msg.author.id,
      username: msg.author.username,
      channel_id: msg.channelId,
      guild_id: msg.guildId
    },
    timestamp: Date.now()
  };

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return true;
    console.error(`❌ N8N returned status ${response.status}`);
    return false;
  } catch (err) {
    console.error("❌ Error sending to N8N:", err);
    return false;
  }
}

// ===== Login to Discord =====
client.login(TOKEN);

// ===== Health Check Server =====
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Discord Script Bot is running\n");
  })
  .listen(PORT, () => console.log(`🏥 Health check on :${PORT}`));

// ===== Graceful Shutdown =====
process.on("SIGTERM", () => {
  userStates.clear();
  client.destroy();
  process.exit(0);
});
process.on("SIGINT", () => {
  userStates.clear();
  client.destroy();
  process.exit(0);
});
