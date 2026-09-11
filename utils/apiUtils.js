import axios from 'axios';
import { config } from '../config.js';

const tokenPool = [config.alt_token].filter(Boolean);
let currentTokenIndex = 0;
let lastRequestTime = 0;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getNextToken() {
    if (tokenPool.length === 0) return config.user_token;
    const token = tokenPool[currentTokenIndex];
    currentTokenIndex = (currentTokenIndex + 1) % tokenPool.length;
    return token;
}

async function throttle() {
    const elapsed = Date.now() - lastRequestTime;
    const minInterval = config.delay_between_requests;
    
    if (elapsed < minInterval) {
        await delay(minInterval - elapsed + Math.random() * 300);
    }
    
    lastRequestTime = Date.now();
}

function buildRequestConfig(token, proxyIp, proxyPort) {
    const requestConfig = {
        headers: {
            Authorization: token,
            'Content-Type': 'application/json'
        },
        timeout: config.request_timeout,
        validateStatus: (status) => status < 500
    };

    if (config.use_proxy && proxyIp) {
        requestConfig.proxy = {
            protocol: 'http',
            host: proxyIp,
            port: parseInt(proxyPort || config.proxy.port)
        };
    } else if (config.use_proxy && config.proxy.hosts.length > 0) {
        const randomHost = config.proxy.hosts[Math.floor(Math.random() * config.proxy.hosts.length)];
        requestConfig.proxy = {
            protocol: 'http',
            host: randomHost,
            port: config.proxy.port
        };
    }

    return requestConfig;
}

export async function fetchUserProfile(userId, proxyIp, proxyPort) {
    const maxRetries = config.max_retries;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await throttle();

            if (attempt > 0) {
                await delay(1000 * attempt + Math.random() * 1000);
            }

            const token = getNextToken();
            const requestConfig = buildRequestConfig(token, proxyIp, proxyPort);

            const response = await axios.get(
                `https://discord.com/api/v10/users/${userId}/profile`,
                requestConfig
            );

            return response.data;

        } catch (error) {
            lastError = error;
            const status = error.response?.status;

            // Rate limited
            if (status === 429) {
                const retryAfter = error.response.data?.retry_after || 10;
                await delay(retryAfter * 1000 + 1000);
                continue;
            }

            if (status === 404) {
                throw error;
            }

            if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(error.code)) {
                try {
                    const fallbackConfig = {
                        headers: {
                            Authorization: getNextToken(),
                            'Content-Type': 'application/json'
                        },
                        timeout: config.request_timeout
                    };

                    const response = await axios.get(
                        `https://discord.com/api/v10/users/${userId}/profile`,
                        fallbackConfig
                    );

                    return response.data;
                } catch (fallbackError) {
                    lastError = fallbackError;
                }
            }

            if (status === 401 || status === 403 || status === 50001) {
                continue;
            }

            if (attempt < maxRetries - 1) {
                await delay(Math.pow(2, attempt) * 1000);
            }
        }
    }

    throw lastError || new Error(`Failed to fetch user ${userId}`);
}

function getNitroDurationBadge(premiumSince) {
    if (!premiumSince) return null;

    const startDate = new Date(premiumSince);
    const now = new Date();

    let months = (now.getFullYear() - startDate.getFullYear()) * 12;
    months -= startDate.getMonth();
    months += now.getMonth();

    if (now.getDate() < startDate.getDate()) months--;

    if (months >= 72) return 'NitroOpal';
    if (months >= 60) return 'NitroRuby';
    if (months >= 36) return 'NitroEmerald';
    if (months >= 24) return 'NitroDiamond';
    if (months >= 12) return 'NitroPlatinum';
    if (months >= 6) return 'NitroGold';
    if (months >= 3) return 'NitroSilver';
    if (months >= 1) return 'NitroBronze';

    return null;
}

function detectQuestBadge(data) {
    const fields = ['user_quest', 'quest_badge', 'active_quests', 'quests', 'quest', 'has_quest', 'user_quest_badge'];
    
    for (const field of fields) {
        const value = data[field];
        if (value === true) return true;
        if (Array.isArray(value) && value.length > 0) return true;
        if (value && typeof value !== 'number' && typeof value !== 'boolean') return true;
    }

    if (Array.isArray(data.badges)) {
        for (const badge of data.badges) {
            const id = (badge.id || '').toLowerCase();
            const name = (badge.name || '').toLowerCase();
            if (id.includes('quest') || name.includes('quest')) return true;
        }
    }

    return false;
}

function getUserBadges(flags) {
    if (!flags) return [];

    const badgeMap = {
        1: 'Staff',
        2: 'Partner',
        4: 'Hypesquad',
        8: 'BugHunterLevel1',
        64: 'HypeSquadOnlineHouse3',
        128: 'HypeSquadOnlineHouse1',
        256: 'HypeSquadOnlineHouse2',
        512: 'PremiumEarlySupporter',
        1024: 'BugHunterLevel2',
        16384: 'VerifiedDeveloper',
        131072: 'ActiveDeveloper'
    };

    const badges = [];
    for (const [flag, name] of Object.entries(badgeMap)) {
        if (flags & parseInt(flag)) badges.push(name);
    }
    return badges;
}

function getBoostInfo(premiumGuildSince) {
    if (!premiumGuildSince) return null;

    const startDate = new Date(premiumGuildSince);
    const now = new Date();
    let months = (now.getFullYear() - startDate.getFullYear()) * 12;
    months -= startDate.getMonth();
    months += now.getMonth();
    if (now.getDate() < startDate.getDate()) months--;
    months = Math.max(0, months);

    const levels = [
        { max: 2, level: 1, next: 2 },
        { max: 3, level: 2, next: 3 },
        { max: 6, level: 3, next: 4 },
        { max: 9, level: 4, next: 5 },
        { max: 12, level: 5, next: 6 },
        { max: 15, level: 6, next: 7 },
        { max: 18, level: 7, next: 8 },
        { max: 24, level: 8, next: 9 }
    ];

    for (const { max, level, next } of levels) {
        if (months < max) {
            const nextDate = new Date(startDate);
            nextDate.setMonth(nextDate.getMonth() + max);
            return {
                boost: `BoostLevel${level}`,
                boostDate: premiumGuildSince,
                nextBoost: `BoostLevel${next}`,
                nextBoostDate: nextDate
            };
        }
    }

    return {
        boost: 'BoostLevel9',
        boostDate: premiumGuildSince,
        nextBoost: 'MaxLevelReached',
        nextBoostDate: 'MaxLevelReached'
    };
}

function getAvatarUrl(user) {
    if (user.avatar) {
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=4096`;
    }
    const discrim = parseInt(user.discriminator || '0') % 5;
    return `https://cdn.discordapp.com/embed/avatars/${discrim}.png`;
}

export function processUserData(data) {
    const user = data.user || {};
    const badges = getUserBadges(user.public_flags) || [];

    if (detectQuestBadge(data)) badges.push('Quest');

    const premiumSince = data.premium_since;
    const premiumType = data.premium_type;

    if (premiumSince) {
        const durationBadge = getNitroDurationBadge(premiumSince);
        if (durationBadge) badges.push(durationBadge);

        if (new Date(premiumSince) < new Date('2018-10-10T00:00:00Z')) {
            badges.push('PremiumEarlySupporter');
        }
    }

    if (premiumType === 1) {
        badges.push('NitroClassic', 'Nitro');
    } else if (premiumType === 2) {
        badges.push('Nitro');
    } else if (premiumType === 3) {
        badges.push('NitroBasic', 'Nitro');
    }

    let boost = null;
    if (data.premium_guild_since) {
        boost = getBoostInfo(data.premium_guild_since);
        if (boost) badges.push(boost.boost);
    }

    const order = [
        'Staff', 'Partner', 'Oldstaff', 'Alumni', 'Hypesquad',
        'BugHunterLevel1', 'BugHunterLevel2', 'VerifiedDeveloper',
        'PremiumEarlySupporter', 'HypeSquadOnlineHouse1', 'HypeSquadOnlineHouse2', 'HypeSquadOnlineHouse3',
        'Nitro', 'NitroClassic', 'NitroBasic',
        'NitroBronze', 'NitroSilver', 'NitroGold', 'NitroPlatinum',
        'NitroDiamond', 'NitroEmerald', 'NitroRuby', 'NitroOpal',
        'Quest',
        'BoostLevel1', 'BoostLevel2', 'BoostLevel3', 'BoostLevel4',
        'BoostLevel5', 'BoostLevel6', 'BoostLevel7', 'BoostLevel8', 'BoostLevel9'
    ];

    badges.sort((a, b) => order.indexOf(a) - order.indexOf(b));

    return {
        user: {
            id: user.id,
            username: user.username || 'Unknown',
            globalName: user.global_name || null,
            createdAt: user.created_at || new Date()
        },
        profile: {
            badgesArray: badges,
            avatarUrl: getAvatarUrl(user)
        },
        boost
    };
}