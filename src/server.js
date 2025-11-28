const { app, server, io } = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const gameService = require('./services/gameService');
require('dotenv').config();

const PORT = process.env.PORT || 5000;

// Connect to MongoDB
connectDB();

gameService.setSocketIo(io);

// Start the server
server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${err.message}`);
    // Application specific logging, throwing an error, or other logic here
    server.close(() => process.exit(1)); // Exit process with failure
});