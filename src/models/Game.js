const mongoose = require('mongoose');
const { Schema } = mongoose;

const analysisEntrySchema = new mongoose.Schema({
    moveNumber: { type: Number, required: true },
    move: { type: String, required: true }, // The player's move (e.g., "e2e4")
    fen: { type: String, required: true },  // FEN after the player's move
    evaluation: { // Stockfish evaluation
        type: { type: String, enum: ['cp', 'mate'], required: true }, // centipawn or mate
        value: { type: Number, required: true } // centipawn value or moves to mate
    },
    bestMove: { type: String, required: true }, // Stockfish's suggested best move
    principalVariation: { type: String, default: '' }, // PV from Stockfish
    isMistake: { type: Boolean, default: false },
    isBlunder: { type: Boolean, default: false },
    comment: { type: String } // e.g., "Mistake: Missed a tactical opportunity."
}, { _id: false }); 

const gameSchema = new mongoose.Schema({
    userId: { 
        type: Schema.Types.ObjectId, // Standard reference type for MongoDB IDs
        ref: 'User',                 
        required: true               // A game must belong to a user
    },

    gameId: { type: String, required: true, unique: true }, // Unique ID for each game session
    players: {
        white: { type: String, default: 'Player 1' }, // Could be a user ID or 'Human'
        black: { type: String, default: 'Computer' } // Could be 'Computer' or 'Human'
    },
    difficulty: { type: Number, min: 1, max: 10, default: null }, // Difficulty level if vs. computer
    pgn: { type: String, default: '' }, // Portable Game Notation
    fen: { type: String, default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1' }, // Current FEN
    moves: [{ type: String }], // Array of UCI moves played
    status: {
        type: String,
        enum: ['waiting', 'playing', 'finished', 'analyzing'],
        default: 'playing' // Default to playing if against AI, waiting if multiplayer
    },
    result: { type: String, enum: ['1-0', '0-1', '1/2-1/2', '*'], default: '*' }, // Game result
    analysis: [analysisEntrySchema], // Array of analysis entries
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Middleware to update `updatedAt` on save
gameSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Game', gameSchema);