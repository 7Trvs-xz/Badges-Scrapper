import express from 'express';
import userRoute from './routes/user.js';
import { config } from './config.js';

const app = express();
const PORT = config.api_port;

app.use(express.json());

app.get('/user/:userId', userRoute);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`Api Listening on port ${PORT}`);
});