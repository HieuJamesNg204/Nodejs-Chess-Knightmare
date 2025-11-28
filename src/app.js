const express = require('express');
const http = require('http'); // Required for Socket.IO
const { Server } = require('socket.io');
const cors = require('cors');
const gameRoutes = require('./routes/gameRoutes');
const authRoutes = require('./routes/authRoutes');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for development. Restrict in production.
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json()); // Body parser for JSON requests

// Routes
app.use('/api/games', gameRoutes);
app.use('/api/auth', authRoutes);

// Basic Socket.IO connection handling
io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    // Example: Join a game room
    socket.on('joinGame', (gameId) => {
        socket.join(gameId);
        logger.info(`Socket ${socket.id} joined game room ${gameId}`);
        // You might want to emit current game state to the joining client here
    });

    // Example: Player makes a move - This might be handled by HTTP POST for validation,
    // then broadcast via Socket.IO
    socket.on('playerMove', async ({ gameId, move }) => {
        logger.debug(`Received playerMove from ${socket.id} for game ${gameId}: ${move}`);
        // In a real application, you'd likely have a more robust way to
        // ensure moves are valid and made by the correct player.
        // For now, we'll let the HTTP POST endpoint handle the actual game logic,
        // and Socket.IO will be used to broadcast updates.
    });

    socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id}`);
        // Implement logic to handle player disconnections, e.g., if a player leaves an ongoing game
        // and needs to be marked as disconnected.
    });
});

// Export app and io for server.js to use
module.exports = { app, server, io };