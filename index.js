import express from 'express';
import bodyParser from 'body-parser';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Increase timeout for Replit
app.use((req, res, next) => {
    res.setTimeout(60000, () => {
        console.log('Request timed out');
        res.status(503).json({ error: 'Request timeout' });
    });
    next();
});

// Static files middleware
app.use(express.static(path.join(__dirname, 'public')));

// Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// Health check endpoint for Replit
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DTZ NOVA X MD running on port ${PORT}`);
    console.log(`📱 Main page: http://localhost:${PORT}`);
    console.log(`🔗 Pair page: http://localhost:${PORT}/pair`);
});

export default app;
