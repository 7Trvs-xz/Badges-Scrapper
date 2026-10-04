import path from 'path';
import { fileURLToPath } from 'url';
import { PermissionFlagsBits } from 'discord.js';
import { BADGE_EMOJI_NAMES, SCRAP_BADGE_KEYS } from './badgeUtils.js';

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const ASSET_EXT = '.webp';

const REQUIRED_EMOJIS = [...new Set(Object.values(BADGE_EMOJI_NAMES))];

const guildEmojis = new Map();
const pendingSyncs = new Map();

const format = (emoji) => `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;

export function isRequiredEmoji(name) {
    return REQUIRED_EMOJIS.includes(name);
}

export function syncGuildEmojis(guild) {
    if (pendingSyncs.has(guild.id)) return pendingSyncs.get(guild.id);

    const promise = doSync(guild).finally(() => pendingSyncs.delete(guild.id));
    pendingSyncs.set(guild.id, promise);
    return promise;
}

async function doSync(guild) {
    const existing = await guild.emojis.fetch();
    const canCreate = guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuildExpressions);
    const resolved = new Map();
    let created = 0;

    for (const name of REQUIRED_EMOJIS) {
        let emoji = existing.find(e => e.name === name);

        if (emoji === undefined) {
            if (!canCreate) continue;
            try {
                emoji = await guild.emojis.create({
                    attachment: path.join(ASSETS_DIR, name + ASSET_EXT),
                    name
                });
                created++;
            } catch (error) {
                console.error(`[EMOJI] ${guild.name}: impossible de créer :${name}: — ${error.message}`);
                continue;
            }
        }

        resolved.set(name, format(emoji));
    }

    guildEmojis.set(guild.id, resolved);

    const missing = REQUIRED_EMOJIS.length - resolved.size;
    console.log(
        `[EMOJI] ${guild.name}: ${resolved.size}/${REQUIRED_EMOJIS.length} prêts (${created} créés)` +
        (missing ? ` — ${missing} manquants${canCreate ? '' : ', permission "Gérer les expressions" absente'}` : '')
    );
}

export function forgetGuild(guildId) {
    guildEmojis.delete(guildId);
}

function buildFor(guildId, badges) {
    const emojis = guildEmojis.get(guildId);
    const result = {};
    for (const badge of badges) {
        const emoji = emojis?.get(BADGE_EMOJI_NAMES[badge]);
        if (emoji) result[badge] = emoji;
    }
    return result;
}

export function getBadgeEmojis(guildId) {
    return buildFor(guildId, Object.keys(BADGE_EMOJI_NAMES));
}

export function getScrapBadges(guildId) {
    return buildFor(guildId, SCRAP_BADGE_KEYS);
}
