import { Client } from 'discord.js-selfbot-v13';
import {
    Client as BotClient,
    GatewayIntentBits,
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    SeparatorBuilder,
    ThumbnailBuilder,
    SeparatorSpacingSize,
    MessageFlags
} from 'discord.js';
import moment from 'moment';
import axios from 'axios';
import fs from 'fs/promises';
import { config } from './config.js';
import { SCRAP_BADGE_KEYS, NITRO_DURATION_BADGES, HQ_BADGES } from './utils/badgeUtils.js';
import { syncGuildEmojis, forgetGuild, isRequiredEmoji, getBadgeEmojis, getScrapBadges } from './utils/emojiManager.js';

const client = new Client({ checkUpdate: false });
const bot = new BotClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildExpressions]
});

let state = {
    scraping: false,
    found: 0,
    processed: 0,
    total: 0,
    hq: false,
    startTime: null
};

class RateLimiter {
    constructor(max) {
        this.max = max;
        this.current = 0;
        this.queue = [];
    }

    async schedule(fn) {
        if (this.current >= this.max) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        this.current++;
        try {
            return await fn();
        } finally {
            this.current--;
            if (this.queue.length > 0) this.queue.shift()();
        }
    }
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

client.on('ready', () => {
    const ascii = [
        ' ____________________                   ',
        ' \\______  \\__    ___/_________  ________',
        '     /    / |    |  \\_  __ \\  \\/ /  ___/',
        '    /    /  |    |   |  | \\/\\   /\\___ \\ ',
        '   /____/   |____|   |__|    \\_//____  >',
        '                                     \\/ '
    ].join('\n');
    console.log(ascii);
    console.log(`SB Connected as ${client.user.tag}`);
    console.log('/scrap slash command to start scraping');
    if (config.use_proxy) {
        console.log(`Using ${config.proxy.hosts.length} proxy IPs:`);
        config.proxy.hosts.forEach(ip => console.log(`  └─ ${ip}:${config.proxy.port}`));
        console.log(`Concurrent requests: ${config.concurrent_requests}`);
    }
});

async function startScraping(guildId, statusMessage, useHQ = false) {
    if (state.scraping) {
        return statusMessage.edit('A scraping process is already running.');
    }

    state = {
        scraping: true,
        found: 0,
        processed: 0,
        total: 0,
        hq: useHQ,
        startTime: Date.now()
    };

    await statusMessage.edit(`Starting ${useHQ ? '**HQ MODE**' : ''} on \`${guildId}\`...`);

    try {
        await fetchMembers(guildId);
        await scrapeMembers(guildId, statusMessage);
    } catch (error) {
        console.error('[ERROR]', error.message);
        await statusMessage.edit(`Error: ${error.message}`);
    } finally {
        state.scraping = false;
        const elapsed = Math.round((Date.now() - state.startTime) / 1000);
        const min = Math.floor(elapsed / 60);
        const sec = elapsed % 60;
        await statusMessage.edit(`Complete ${state.found} profiles found in ${min}m${sec}s${useHQ ? ' (HQ)' : ''}`);
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.id !== client.user.id) return;
    if (!message.content.startsWith('!scrap')) return;

    const args = message.content.split(' ');
    if (args.length < 2) return message.edit('Usage: `!scrap <guildId> [hq]`');

    const useHQ = ['hq', 'true'].includes(args[2]?.toLowerCase());
    await startScraping(args[1], message, useHQ);
});

bot.on('ready', async () => {
    console.log(`Connected as ${bot.user.tag}`);

    const command = new SlashCommandBuilder()
        .setName('scrap')
        .setDescription('Scrape badges from a Discord server')
        .addStringOption(o => o.setName('guildid').setDescription('Server ID').setRequired(true))
        .addBooleanOption(o => o.setName('hq').setDescription('HQ mode: only rare badges').setRequired(true));

    await bot.application.commands.create(command, config.command_guild_id);
    console.log('/scrap registered');

    for (const guild of bot.guilds.cache.values()) {
        await syncGuildEmojis(guild).catch(e => console.error(`[EMOJI] ${guild.name}: ${e.message}`));
    }
});

bot.on('guildCreate', (guild) => {
    syncGuildEmojis(guild).catch(e => console.error(`[EMOJI] ${guild.name}: ${e.message}`));
});

bot.on('guildDelete', (guild) => forgetGuild(guild.id));

bot.on('emojiDelete', (emoji) => {
    if (!isRequiredEmoji(emoji.name)) return;
    syncGuildEmojis(emoji.guild).catch(e => console.error(`[EMOJI] ${emoji.guild.name}: ${e.message}`));
});

bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'scrap') return;

    await interaction.deferReply();

    const guildId = interaction.options.getString('guildid');
    const useHQ = interaction.options.getBoolean('hq');

    await startScraping(guildId, {
        edit: (content) => interaction.editReply(content)
    }, useHQ);
});

async function fetchMembers(guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.members.fetch();

    const ids = guild.members.cache
        .filter(m => !m.user.bot)
        .map(m => m.id);

    await fs.mkdir('./files', { recursive: true });
    await fs.writeFile(`./files/${guildId}.txt`, ids.join('\n'));

    state.total = ids.length;
    console.log(`[FETCH] ${state.total} members saved`);
}

async function scrapeMembers(guildId, statusMessage) {
    const guild = await client.guilds.fetch(guildId);
    const invite = await createInvite(guild);

    const memberIds = (await fs.readFile(`./files/${guildId}.txt`, 'utf8'))
        .split('\n')
        .filter(Boolean);

    state.total = memberIds.length;

    const concurrent = config.concurrent_requests;
    const limiter = new RateLimiter(concurrent);

    let index = 0;
    let failed = 0;

    while (index < memberIds.length) {
        const batch = memberIds.slice(index, index + concurrent);

        const promises = batch.map((id, i) => {
            const proxyIndex = (index + i) % config.proxy.hosts.length;
            const proxyIP = config.proxy.hosts[proxyIndex];
            return limiter.schedule(() => processMember(id, invite, proxyIP, index + i));
        });

        const results = await Promise.allSettled(promises);

        for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
                state.found++;
                await sendProfile(r.value);
            } else if (r.status === 'rejected') {
                failed++;
            }
        }

        state.processed += batch.length;
        index += concurrent;

        const percent = Math.round((state.processed / state.total) * 100);
        await statusMessage.edit(
            `${percent}% • ${state.found} found • ${state.processed}/${state.total} (${failed} failed)${state.hq ? ' **[HQ]**' : ''}`
        );

        if (index < memberIds.length) {
            await delay(config.delay_between_batches + Math.random() * 2000);
        }
    }

    console.log(`[DONE] ${state.found} profiles found`);
}

async function processMember(memberId, invite, proxyIP, index) {
    for (let attempt = 0; attempt < config.max_retries; attempt++) {
        try {
            if (attempt > 0) await delay(2000 * attempt + Math.random() * 1000);

            const { data } = await axios.get(
                `http://localhost:${config.api_port}/user/${memberId}`,
                {
                    params: { proxy_ip: proxyIP, proxy_port: config.proxy.port },
                    timeout: 30000
                }
            );

            if (!data.profile?.badgesArray) return null;

            const badges = [...new Set(data.profile.badgesArray)];
            const cleaned = cleanBadges(badges);

            if (state.hq && !cleaned.some(b => HQ_BADGES.includes(b))) {
                return null;
            }

            const scraped = cleaned.filter(b => SCRAP_BADGE_KEYS.includes(b));
            if (scraped.length === 0) return null;

            console.log(`[${index + 1}/${state.total}] ${data.user.globalName || data.user.username}`);

            return {
                user: data.user,
                profile: data.profile,
                scrapedBadges: scraped,
                boost: data.boost,
                invite,
                progress: `${index + 1}/${state.total}`
            };
        } catch (error) {
            const status = error.response?.status;

            if (status === 404) return null;
            if (status === 429) {
                await delay((error.response.data?.retry_after || 10) * 1000);
                continue;
            }

            if (['ECONNREFUSED', 'ETIMEDOUT'].includes(error.code)) {
                const nextIndex = (config.proxy.hosts.indexOf(proxyIP) + 1) % config.proxy.hosts.length;
                proxyIP = config.proxy.hosts[nextIndex];
                continue;
            }
        }
    }

    return null;
}

async function sendProfile(data) {
    const channel = await bot.channels.fetch(config.channel_id);
    const BADGE_EMOJIS = getBadgeEmojis(channel.guildId);
    const SCRAP_BADGES = getScrapBadges(channel.guildId);
    const emojis = data.scrapedBadges.map(b => SCRAP_BADGES[b] || `\`${b}\``).join(' ');

    const container = new ContainerBuilder().setAccentColor(0x000000);

    const header = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${data.user.globalName || data.user.username}\n> @${data.user.username}`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder({ media: { url: data.profile.avatarUrl } })
        );

    container.addSectionComponents(header);

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**Badges**\n${emojis || 'None'}`
        )
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**Created** • <t:${moment(data.user.createdAt).unix()}:R>\n**ID** • \`${data.user.id}\``
        )
    );

    if (data.boost) {
        const emoji = BADGE_EMOJIS[data.boost.boost] || '⭐';
        const level = data.boost.boost.replace('BoostLevel', 'Level ');

        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );

        let text = `**Boost** ${emoji} ${level} • <t:${moment(data.boost.boostDate).unix()}:R>`;

        if (data.boost.boost !== 'BoostLevel9') {
            const nextEmoji = BADGE_EMOJIS[data.boost.nextBoost] || '⬆️';
            const nextLevel = data.boost.nextBoost.replace('BoostLevel', 'Level ');
            text += `\n**Next** ${nextEmoji} ${nextLevel} • <t:${moment(data.boost.nextBoostDate).unix()}:R>`;
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    }

    if (data.invite) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**Server** • ${data.invite}`)
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# ${data.scrapedBadges.length} badges • ${data.progress}${state.hq ? ' • HQ' : ''}`
        )
    );

    await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });
}

function cleanBadges(badges) {
    let cleaned = [...new Set(badges)];
    const hasDuration = cleaned.some(b => NITRO_DURATION_BADGES.includes(b));

    if (hasDuration || cleaned.includes('NitroClassic')) {
        cleaned = cleaned.filter(b => b !== 'NitroBasic' && b !== 'Nitro');
    }

    return cleaned;
}

async function createInvite(guild) {
    try {
        const channel = guild.channels.cache.find(
            c => c.type === 'GUILD_TEXT' && c.permissionsFor(guild.members.me).has('CREATE_INSTANT_INVITE')
        );

        if (channel) {
            const invite = await channel.createInvite({ maxAge: 0, maxUses: 0 });
            return `[${guild.name}](${invite.url})`;
        }
    } catch {
        if (guild.vanityURLCode) {
            return `[${guild.name}](https://discord.gg/${guild.vanityURLCode})`;
        }
    }
    return `**${guild.name}**`;
}

client.login(config.alt_token);
bot.login(config.bot_token);
