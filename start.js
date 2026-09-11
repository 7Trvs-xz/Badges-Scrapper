import 'dotenv/config';
import { spawn } from 'child_process';

console.log('Launching API server');

const server = spawn('node', ['server.js'], { stdio: 'inherit' });

server.on('error', (err) => {
    console.error('SERVER ERROR', err);
    process.exit(1);
});

server.on('exit', (code) => {
    if (code !== 0) {
        console.error(`EXIT code ${code}`);
        process.exit(code);
    }
});

setTimeout(() => {
    console.log('Launching Discord bot...');
    
    const bot = spawn('node', ['index.js'], { stdio: 'inherit' });

    bot.on('error', (err) => {
        console.error('bot error', err);
        server.kill();
        process.exit(1);
    });

    bot.on('exit', (code) => {
        console.log(`EXIT code ${code}`);
        server.kill();
        process.exit(code);
    });
}, 3000);

process.on('SIGINT', () => {
    console.log('\nStopping all processes...');
    server.kill();
    process.exit(0);
});