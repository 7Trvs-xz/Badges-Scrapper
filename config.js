export const config = {
    user_token: process.env.USER_TOKEN || '',
    alt_token: process.env.ALT_TOKEN || '',
    bot_token: process.env.BOT_TOKEN || '',
    command_guild_id: process.env.COMMAND_GUILD_ID || '',
    channel_id: process.env.CHANNEL_ID || '',

    api_port: 3000,
    request_timeout: 30000,

    concurrent_requests: 3,
    delay_between_requests: 2000,
    delay_between_batches: 5000,
    max_retries: 5,

    use_proxy: true,
    proxy: {
        hosts: [
        ],
        port: 1337
    }
};