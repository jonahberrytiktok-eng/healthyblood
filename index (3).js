// index.js - Interactive Discord Bot with Two N8N Webhooks
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

// Store user conversation state
const userStates = new Map();

// Prevent duplicate processing within short time window
const recentlyProcessed = new Map();

// Track processed message IDs to prevent duplicate handling
const processedMessages = new Set();

// Avatar options (must match your Google Drive file)
const avatarOptions = [
  "Burned by Big Pharma Brian",
  "Pre-Transplant Tom",
  "Confidence Crisis Chris",
  "Skeptical Steve",
  "Concerned Girlfriend Caroline",
  "Natural Nathan",
  "Zocial Zeph",
  "Biohacker Bob"
];

// Script format options (must match your Google Drive file)
const scriptOptions = [
  "Timeline",
  "Comparison",
  "Problem/Solution",
  "Testimonials",
  "UGC Mashup",
  "Mythbusting",
  "Education",
  "Fix This",
  "Scroll Stopper",
  "Customer Journey",
  "Demonstration",
  "Stats/Data",
  "Reaction Video",
  "3 Reasons Why",
  "VSL (Video Sales Letter)",
  "Lifestyle",
  "Whiteboard",
  "Urgency/Scarcity",
  "Celebrity/Influencer",
  "Founder Story",
  "Native Style",
  "How To",
  "Behind The Scenes",
  "Challenge",
  "Unboxing",
  "Street Interviews",
  "Blog",
  "Announcement",
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
    // Ignore all bot messages (including our own)
    if (msg.author.bot) return;
    
    // Prevent duplicate processing of the same message
    if (processedMessages.has(msg.id)) {
      console.log(`⏭️ Already processed message ${msg.id}, skipping`);
      return;
    }
    processedMessages.add(msg.id);
    
    // Clean up old message IDs (keep last 100)
    if (processedMessages.size > 100) {
      const firstItem = processedMessages.values().next().value;
      processedMessages.delete(firstItem);
    }
    
    // Optional: filter by channel
    if (CHANNEL_ID && msg.channelId !== CHANNEL_ID) return;

    const userId = msg.author.id;
    const userState = userStates.get(userId);

    // Check if user is in a conversation
    if (userState) {
      await handleConversationStep(msg, userState);
      return;
    }

    // Start new conversation ONLY when directly mentioned by a user
    if (msg.mentions.has(client.user)) {
      // Prevent double-triggering: check if we just processed this user recently
      const lastProcessed = recentlyProcessed.get(userId);
      if (lastProcessed && Date.now() - lastProcessed < 5000) {
        console.log(`⏭️ Skipping duplicate mention from ${msg.author.username} (processed ${Date.now() - lastProcessed}ms ago)`);
        return;
      }
      
      // Check if user already has an active conversation
      if (userStates.has(userId)) {
        console.log(`⏭️ User ${msg.author.username} already has an active conversation`);
        return;
      }
      
      console.log(`🚀 Starting new script request from ${msg.author.username}`);
      recentlyProcessed.set(userId, Date.now());
      await startAvatarSelection(msg);
      
      // Clean up after 10 seconds
      setTimeout(() => recentlyProcessed.delete(userId), 10000);
    }

  } catch (err) {
    console.error("❌ Error handling message:", err);
    msg.reply("❌ Sorry, something went wrong! Please try again.").catch(console.error);
  }
});

// Start the avatar selection process
async function startAvatarSelection(msg) {
  // Check if we're already processing this user
  const userId = msg.author.id;
  if (userStates.has(userId)) {
    console.log(`⚠️ User ${msg.author.username} already has an active conversation, skipping`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("📝 Please select an avatar for this script:")
    .setDescription(
      avatarOptions.map((avatar, i) => `**${i + 1}** ${avatar}`).join('\n')
    )
    .setFooter({ text: "Reply with the number (1-8) to continue." });

  const avatarMsg = await msg.reply({ embeds: [embed] });

  // Store user state with message IDs for cleanup
  userStates.set(userId, {
    step: 'avatar',
    channelId: msg.channelId,
    guildId: msg.guildId,
    selections: {},
    messagesToDelete: [avatarMsg.id], // Track messages to delete later
    startedAt: Date.now() // Track when this conversation started
  });

  // Auto-cleanup after 5 minutes
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
  
  console.log(`🔍 Processing step: ${userState.step}, selection: ${selection}, user: ${msg.author.username}`);
  
  // Prevent processing the same message multiple times
  if (userState.lastMessageId === msg.id) {
    console.log(`⏭️ Already processed message ${msg.id}, skipping`);
    return;
  }
  userState.lastMessageId = msg.id;

  if (userState.step === 'avatar') {
    console.log(`📍 In avatar step`);
    // Validate avatar selection
    if (isNaN(selection) || selection < 1 || selection > avatarOptions.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${avatarOptions.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    console.log(`✅ Avatar selected: ${selection} - ${avatarOptions[selection - 1]}`);

    // Store avatar selection
    userState.selections.avatar = {
      number: selection,
      name: avatarOptions[selection - 1]
    };

    // Track user's selection message for deletion
    userState.messagesToDelete.push(msg.id);

    // Move to script format selection
    userState.step = 'format';
    console.log(`➡️ Moving to format step`);

    // Small delay to prevent rapid-fire messages
    await new Promise(resolve => setTimeout(resolve, 500));

    const embed = new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle("🎬 Now select a script format:")
      .setDescription(
        scriptOptions.map((script, i) => `**${i + 1}** ${script}`).join('\n')
      )
      .setFooter({ text: "Reply with the number (1-30) to continue." });

    const formatMsg = await msg.reply({ embeds: [embed] });
    userState.messagesToDelete.push(formatMsg.id);

  } else if (userState.step === 'format') {
    console.log(`📍 In format step`);
    // Validate format selection
    if (isNaN(selection) || selection < 1 || selection > scriptOptions.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${scriptOptions.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    console.log(`✅ Format selected: ${selection} - ${scriptOptions[selection - 1]}`);

    // Store format selection
    userState.selections.format = {
      number: selection,
      name: scriptOptions[selection - 1]
    };

    // Track user's selection message for deletion
    userState.messagesToDelete.push(msg.id);

    // Move to sophistication level selection
    userState.step = 'sophistication';
    console.log(`➡️ Moving to sophistication step`);

    // Small delay to prevent rapid-fire messages
    await new Promise(resolve => setTimeout(resolve, 500));

    const sophisticationEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle("🎯 Select market sophistication level:")
      .setDescription(
        sophisticationLevels.map((level, i) => `**${i + 1}** ${level}`).join('\n\n')
      )
      .setFooter({ text: "Reply with the number (1-5) to continue." });

    const sophisticationMsg = await msg.reply({ embeds: [sophisticationEmbed] });
    userState.messagesToDelete.push(sophisticationMsg.id);

  } else if (userState.step === 'sophistication') {
    console.log(`📍 In sophistication step`);
    // Validate sophistication selection
    if (isNaN(selection) || selection < 1 || selection > sophisticationLevels.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${sophisticationLevels.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    console.log(`✅ Sophistication selected: ${selection} - ${sophisticationLevels[selection - 1]}`);

    // Store sophistication selection
    userState.selections.sophistication = {
      number: selection,
      level: sophisticationLevels[selection - 1]
    };

    // Track user's selection message for deletion
    userState.messagesToDelete.push(msg.id);

    // Move to video length selection
    userState.step = 'length';
    console.log(`➡️ Moving to length step`);

    // Small delay to prevent rapid-fire messages
    await new Promise(resolve => setTimeout(resolve, 500));

    const lengthEmbed = new EmbedBuilder()
      .setColor(0x9B59B6)
      .setTitle("⏱️ Select video length:")
      .setDescription(
        videoLengths.map((length, i) => `**${i + 1}** ${length}`).join('\n\n')
      )
      .setFooter({ text: "Reply with the number (1-4) to continue." });

    const lengthMsg = await msg.reply({ embeds: [lengthEmbed] });
    userState.messagesToDelete.push(lengthMsg.id);

  } else if (userState.step === 'length') {
    console.log(`📍 In length step - FINAL STEP`);
    // Validate length selection
    if (isNaN(selection) || selection < 1 || selection > videoLengths.length) {
      const errorMsg = await msg.reply(`❌ Please enter a valid number (1-${videoLengths.length})`);
      userState.messagesToDelete.push(msg.id, errorMsg.id);
      return;
    }

    console.log(`✅ Video length selected: ${selection} - ${videoLengths[selection - 1]}`);

    // IMPORTANT: Mark as processing to prevent duplicate submissions
    if (userState.processing) {
      console.log(`⚠️ Already processing submission for ${msg.author.username}, skipping duplicate`);
      return;
    }
    userState.processing = true;

    // Store length selection
    userState.selections.length = {
      number: selection,
      description: videoLengths[selection - 1]
    };

    // Track user's selection message for deletion
    userState.messagesToDelete.push(msg.id);

    console.log(`📦 All selections complete, preparing to send to N8N...`);

    // Show confirmation (this will also be deleted)
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

    // Send ALL selections to N8N in one payload
    const sent = await sendToN8N(msg, userState.selections);

    if (!sent) {
      await confirmMsg.edit({ content: "❌ Failed to submit request. Please try again.", embeds: [] });
      userStates.delete(msg.author.id);
      return;
    }

    // Final success message (this one stays!)
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

    // Delete all previous messages (cleanup)
    console.log(`🧹 Cleaning up ${userState.messagesToDelete.length} messages...`);
    await cleanupMessages(msg.channel, userState.messagesToDelete);

    // Clean up user state
    console.log(`✅ State cleanup complete for ${msg.author.username}`);
    userStates.delete(msg.author.id);
  }
}

// Helper function to bulk delete messages
async function cleanupMessages(channel, messageIds) {
  try {
    // Discord allows bulk delete for messages less than 14 days old
    // and requires at least 2 messages, max 100 at a time
    if (messageIds.length === 0) return;
    
    if (messageIds.length === 1) {
      // Delete single message
      const message = await channel.messages.fetch(messageIds[0]).catch(() => null);
      if (message) await message.delete().catch(console.error);
    } else if (messageIds.length <= 100) {
      // Bulk delete (more efficient)
      await channel.bulkDelete(messageIds, true).catch(err => {
        console.error("Bulk delete failed, trying individual deletes:", err.message);
        // Fallback to individual deletion
        messageIds.forEach(async (id) => {
          const message = await channel.messages.fetch(id).catch(() => null);
          if (message) await message.delete().catch(console.error);
        });
      });
    } else {
      // Too many messages, delete in chunks
      for (let i = 0; i < messageIds.length; i += 100) {
        const chunk = messageIds.slice(i, i + 100);
        await channel.bulkDelete(chunk, true).catch(console.error);
      }
    }
    console.log(`✅ Deleted ${messageIds.length} messages`);
  } catch (err) {
    console.error("Error cleaning up messages:", err);
  }
}

// Send all selections to N8N
async function sendToN8N(msg, selections) {
  const payload = {
    avatar: {
      data: {
        text: selections.avatar.number.toString() // "2"
      },
      name: selections.avatar.name
    },
    format: {
      data: {
        text: selections.format.number.toString() // "4"
      },
      name: selections.format.name
    },
    sophistication: {
      data: {
        text: selections.sophistication.number.toString() // "3"
      },
      level: selections.sophistication.level
    },
    length: {
      data: {
        text: selections.length.number.toString() // "2"
      },
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

  console.log(`📤 Sending to N8N:`, JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log(`✅ Sent to N8N successfully (status ${response.status})`);
      return true;
    } else {
      console.error(`❌ N8N returned status ${response.status}`);
      return false;
    }
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
  console.log("SIGTERM received, shutting down...");
  userStates.clear();
  client.destroy();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down...");
  userStates.clear();
  client.destroy();
  process.exit(0);
});
