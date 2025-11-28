const mongoose = require('mongoose');
const logger = require('../utils/logger');
require('dotenv').config();

const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
            logger.error('MONGODB_URI is not defined in .env file');
            process.exit(1);
        }
        await mongoose.connect(mongoUri);
        logger.info('MongoDB Connected...');
    } catch (err) {
        logger.error(`MongoDB connection error: ${err.message}`);
        process.exit(1); // Exit process with failure
    }
};

module.exports = connectDB;