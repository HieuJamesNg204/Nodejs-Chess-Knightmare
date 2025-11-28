const express = require('express');
const router = express.Router();
const gameService = require('../services/gameService');
const logger = require('../utils/logger');
const auth = require('../middleware/auth');

// POST /api/games/new - Create a new game
router.post('/new', auth, async (req, res) => {
    try {
        const userId = req.user.id; // <-- GET userId from authenticated user
        const { difficulty, playerColor } = req.body; // playerColor: 'white' or 'black'

        if (!difficulty || !playerColor) {
            return res.status(400).json({ message: 'Difficulty and playerColor are required.' });
        }
        if (difficulty < 1 || difficulty > 10) {
            return res.status(400).json({ message: 'Difficulty must be between 1 and 10.' });
        }
        if (!['white', 'black'].includes(playerColor)) {
            return res.status(400).json({ message: 'playerColor must be "white" or "black".' });
        }

        // Pass userId to the service layer
        const { game, aiMove } = await gameService.createGame(userId, parseInt(difficulty), playerColor); 
        
        res.status(201).json({
            message: 'Game created successfully',
            gameId: game.gameId,
            initialFen: game.fen,
            playerColor: playerColor,
            aiMove: aiMove // If AI played first
        });
    } catch (error) {
        logger.error(`Error creating game: ${error.message}`);
        res.status(500).json({ message: 'Failed to create game', error: error.message });
    }
});

// POST /api/games/:gameId/move - Make a move
router.post('/:gameId/move', auth, async (req, res) => {
    try {
        const { gameId } = req.params;
        const { move } = req.body; // Move in UCI format (e.g., 'e2e4')

        if (!move) {
            return res.status(400).json({ message: 'Move is required.' });
        }

        const { game, aiMove, status } = await gameService.makeMove(gameId, move);
        res.json({
            message: 'Move successful',
            gameId: game.gameId,
            fen: game.fen,
            pgn: game.pgn,
            moves: game.moves,
            status: status,
            result: game.result,
            aiMove: aiMove // AI's counter-move if applicable
        });
    } catch (error) {
        logger.error(`Error making move for game ${req.params.gameId}: ${error.message}`);
        res.status(400).json({ message: 'Invalid move or game state', error: error.message });
    }
});

router.get('/history', auth, async (req, res) => {
    try {
        const userId = req.user.id; // Get userId from authenticated user
        const history = await gameService.getGameHistory(userId);
        res.json(history);
    } catch (error) {
        logger.error(`Error fetching game history for user ${req.user.id}: ${error.message}`);
        res.status(500).json({ message: 'Failed to fetch game history', error: error.message });
    }
});

// GET /api/games/:gameId - Get game state
router.get('/:gameId', auth, async (req, res) => {
    try {
        const { gameId } = req.params;
        const game = await gameService.getGameById(gameId);
        res.json(game);
    } catch (error) {
        logger.error(`Error fetching game ${req.params.gameId}: ${error.message}`);
        res.status(404).json({ message: 'Game not found', error: error.message });
    }
});

// POST /api/games/:gameId/analyze - Analyze a completed game
router.post('/:gameId/analyze', auth, async (req, res) => {
    try {
        const { gameId } = req.params;
        const game = await gameService.analyzeGame(gameId);
        res.json({
            message: 'Game analysis complete',
            gameId: game.gameId,
            analysis: game.analysis
        });
    } catch (error) {
        logger.error(`Error analyzing game ${req.params.gameId}: ${error.message}`);
        res.status(400).json({ message: 'Failed to analyze game', error: error.message });
    }
});

// POST /api/games/:gameId/terminate - Terminate a game (e.g., user leaves)
router.post('/:gameId/terminate', auth, async (req, res) => {
    try {
        const { gameId } = req.params;
        await gameService.terminateGame(gameId);
        res.json({ message: `Game ${gameId} terminated successfully.` });
    } catch (error) {
        logger.error(`Error terminating game ${req.params.gameId}: ${error.message}`);
        res.status(500).json({ message: 'Failed to terminate game', error: error.message });
    }
});

module.exports = router;