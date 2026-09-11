import { fetchUserProfile, processUserData } from '../utils/apiUtils.js';

export default async (req, res) => {
    const { userId } = req.params;
    const { proxy_ip, proxy_port } = req.query;

    if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
    }

    try {
        const profile = await fetchUserProfile(userId, proxy_ip, proxy_port);
        const data = processUserData(profile);
        res.json(data);
    } catch (error) {
        const status = error.response?.status || 500;
        const message = error.response?.status === 404 ? 'User not found' : 'Failed to fetch profile';
        
        res.status(status).json({ error: message });
    }
};