const { Chess } = require('chess.js');
const Game = require('../models/Game');
const stockfishService = require('./stockfishService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid'); // For unique game IDs

const activeGames = new Map(); // gameId -> { chessInstance, players, difficulty }
let ioInstance; // To hold the Socket.IO server instance

const setSocketIo = (io) => {
    ioInstance = io;
};

/**
 * Creates a new chess game.
 * @param {string} userId - The ID of the authenticated user.
 * @param {number} difficulty - Difficulty level for AI (1-10)
 * @param {string} playerColor - 'white' or 'black' for human player
 * @returns {Promise<Game>} - The newly created game document
 */
const createGame = async (userId, difficulty, playerColor) => {
    const gameId = uuidv4();
    const chess = new Chess();
    const computerColor = playerColor === 'white' ? 'black' : 'white';

    const gameData = {
        gameId,
        userId: userId,
        players: {
            // Store the actual userId for the human and a string for the AI
            white: playerColor === 'white' ? 'Human' : 'Computer', 
            black: playerColor === 'black' ? 'Human' : 'Computer'
        },
        humanColor: playerColor,
        difficulty: difficulty,
        fen: chess.fen(),
        pgn: chess.pgn(),
        moves: [],
        status: 'playing'
    };

    const newGame = new Game(gameData);
    await newGame.save();

    activeGames.set(gameId, {
        chessInstance: chess,
        players: gameData.players,
        difficulty: difficulty
    });

    logger.info(`New game created: ${gameId} (Difficulty: ${difficulty}, Player Color: ${playerColor}, User: ${userId})`);

    await stockfishService.initializeEngine(gameId, difficulty);

    let aiMove = null;
    // The computer makes the first move if the human is playing black
    if (playerColor === 'black') {
        logger.info(`Computer (White) making first move for game ${gameId}...`);
        const { bestMove: computerMove } = await stockfishService.getBestMove(gameId, chess.fen(), difficulty);
        if (computerMove) {
            chess.move(computerMove);
            newGame.moves.push(computerMove);
            newGame.fen = chess.fen();
            newGame.pgn = chess.pgn();
            await newGame.save();
            aiMove = computerMove;
            logger.info(`Computer played: ${aiMove} for game ${gameId}`);

            // Broadcast AI's first move
            if (ioInstance) {
                ioInstance.to(gameId).emit('gameStateUpdate', {
                    fen: newGame.fen,
                    pgn: newGame.pgn,
                    moves: newGame.moves,
                    status: newGame.status,
                    aiMove: aiMove,
                    result: newGame.result
                });
            }
        } else {
            logger.error(`Stockfish failed to make a first move for game ${gameId}`);
            // The terminateGame service function here for clean up
            await terminateGame(gameId); 
            throw new Error("Computer failed to make a first move.");
        }
    }

    return {
        game: newGame.toObject(),
        aiMove: aiMove
    };
};

/**
 * Retrieves game history for a specific user.
 * @param {string} userId - The ID of the authenticated user.
 * @returns {Promise<Array<Game>>} - List of game documents
 */
const getGameHistory = async (userId) => {
    // Only fetch essential fields for a list view
    return Game.find({ userId: userId, status: { $in: ['finished', 'analyzing', 'terminated'] } })
        .sort({ updatedAt: -1 }) // Sort by last update time (most recent first)
        .select('gameId status result difficulty humanColor createdAt updatedAt'); 
};

/**
 * Makes a player's move.
 * @param {string} gameId
 * @param {string} move - UCI move string (e.g., 'e2e4')
 * @returns {Promise<{game: Game, aiMove: string|null, status: string}>}
 */
const makeMove = async (gameId, move) => {
    const gameData = activeGames.get(gameId);
    if (!gameData) {
        throw new Error('Game not found or has ended.');
    }

    const { chessInstance, players, difficulty } = gameData;
    const gameDoc = await Game.findOne({ gameId });

    if (!gameDoc || gameDoc.status !== 'playing') {
        throw new Error('Game is not active or has ended.');
    }

    const humanPlayerColor = players.white === 'Human' ? 'w' : 'b';
    if (humanPlayerColor !== chessInstance.turn()) {
        throw new Error(`It's not the human's turn. Current turn: ${chessInstance.turn()}`);
    }

    try {
        const result = chessInstance.move(move);
        if (result === null) {
            throw new Error('Invalid move.');
        }

        gameDoc.moves.push(move);
        gameDoc.fen = chessInstance.fen();
        gameDoc.pgn = chessInstance.pgn();

        let aiMove = null;
        let gameStatus = 'playing';
        let gameResult = '*';

        if (chessInstance.isGameOver()) {
            gameStatus = 'finished';
            if (chessInstance.isCheckmate()) {
                gameResult = chessInstance.turn() === 'w' ? '0-1' : '1-0';
            } else if (chessInstance.isDraw()) {
                gameResult = '1/2-1/2';
            }
            gameDoc.status = gameStatus;
            gameDoc.result = gameResult;
            logger.info(`Game ${gameId} finished. Result: ${gameResult}`);
            stockfishService.terminateEngine(gameId);
            activeGames.delete(gameId);
        } else {
            // If game not over, and it's AI's turn, get AI move
            if (players.white === 'Computer' && chessInstance.turn() === 'w' ||
                players.black === 'Computer' && chessInstance.turn() === 'b') {
                logger.info(`Computer making move for game ${gameId}...`);
                const { bestMove: computerMove } = await stockfishService.getBestMove(gameId, chessInstance.fen(), difficulty);
                if (computerMove) {
                    const aiResult = chessInstance.move(computerMove);
                    if (aiResult) {
                        gameDoc.moves.push(computerMove);
                        gameDoc.fen = chessInstance.fen();
                        gameDoc.pgn = chessInstance.pgn();
                        aiMove = computerMove;
                        logger.info(`Computer played: ${aiMove} for game ${gameId}`);
                    } else {
                        logger.error(`Stockfish generated an invalid move: ${computerMove} for FEN: ${chessInstance.fen()}`);
                        throw new Error("AI generated an invalid move.");
                    }
                } else {
                    logger.error(`Stockfish failed to make a move for game ${gameId}`);
                    throw new Error("AI failed to make a move.");
                }

                if (chessInstance.isGameOver()) {
                    gameStatus = 'finished';
                    if (chessInstance.isCheckmate()) {
                        gameResult = chessInstance.turn() === 'w' ? '0-1' : '1-0';
                    } else if (chessInstance.isDraw()) {
                        gameResult = '1/2-1/2';
                    }
                    gameDoc.status = gameStatus;
                    gameDoc.result = gameResult;
                    logger.info(`Game ${gameId} finished. Result: ${gameResult}`);
                    stockfishService.terminateEngine(gameId);
                    activeGames.delete(gameId);
                }
            }
        }

        await gameDoc.save();

        // Broadcast game state update
        if (ioInstance) {
            ioInstance.to(gameId).emit('gameStateUpdate', {
                fen: gameDoc.fen,
                pgn: gameDoc.pgn,
                moves: gameDoc.moves,
                status: gameStatus,
                aiMove: aiMove,
                result: gameResult
            });
        }

        return {
            game: gameDoc.toObject(),
            aiMove,
            status: gameStatus
        };

    } catch (error) {
        logger.error(`Error making move for game ${gameId}: ${error.message}`);
        throw error;
    }
};

/**
 * Analyzes a completed game and stores the analysis.
 * @param {string} gameId
 * @returns {Promise<Game>} - The updated game document with analysis
 */
const analyzeGame = async (gameId) => {
    const gameDoc = await Game.findOne({ gameId });
    if (!gameDoc) {
        throw new Error('Game not found.');
    }
    if (gameDoc.status !== 'finished') {
        throw new Error('Game is not finished and cannot be analyzed.');
    }
    if (gameDoc.analysis && gameDoc.analysis.length > 0) {
        logger.info(`Game ${gameId} already analyzed. Returning existing analysis.`);
        return gameDoc;
    }

    logger.info(`Starting analysis for game ${gameId}...`);
    gameDoc.status = 'analyzing';
    await gameDoc.save();

    const chess = new Chess();
    const analysisResults = [];

    // Helper: Convert Stockfish evaluation to a single integer (Centipawns)
    // Positive = Advantage for side to move.
    const getCpValue = (evaluation) => {
        if (evaluation.type === 'cp') return evaluation.value;
        if (evaluation.type === 'mate') {
            // If mate is positive (winning), return huge number. If negative (losing), return small number.
            // We favor closer mates (Mate in 1 > Mate in 5), so we subtract distance from max.
            const MATE_VALUE = 10000;
            const sign = Math.sign(evaluation.value);
            // Example: Mate in 1 = 10000 - 1 = 9999. Mate in -1 = -9999.
            if (evaluation.value === 0) return 0; // Should handle checkmate on board separately
            return sign * (MATE_VALUE - Math.abs(evaluation.value));
        }
        return 0;
    };

    // 1. Initial Analysis (Starting Position)
    // We need the baseline before the first move is even made.
    let currentAnalysis = await stockfishService.analyzePosition(chess.fen());

    for (let i = 0; i < gameDoc.moves.length; i++) {
        const moveSan = gameDoc.moves[i];
        const fenBeforeMove = chess.fen();
        const turnColor = chess.turn(); // 'w' or 'b'
        
        // 2. Determine who played this move (for checking "Human" mistakes)
        const isWhiteTurn = turnColor === 'w';
        const isHumanMove = (isWhiteTurn && gameDoc.players.white === 'Human') ||
                            (!isWhiteTurn && gameDoc.players.black === 'Human');

        // Capture data derived from the position BEFORE the move was made
        const bestMoveStart = currentAnalysis.bestMove;
        const evalStart = currentAnalysis.evaluation;
        const cpStart = getCpValue(evalStart);

        // 3. Execute the move
        try {
            const moveResult = chess.move(moveSan);
            if (!moveResult) throw new Error(`Invalid SAN: ${moveSan}`);
        } catch (e) {
            logger.error(`Analysis failed at move ${i + 1} (${moveSan}): ${e.message}`);
            break; // Stop analysis if game state is broken
        }

        const fenAfterMove = chess.fen();
        let evalAfter, bestMoveAfter, pvAfter;

        // 4. Analyze the new position (Result of the move)
        // Check if game is over (Checkmate/Draw) to avoid engine errors on final position
        if (chess.isGameOver()) {
            // Manually construct the final evaluation
            if (chess.isCheckmate()) {
                // If it's checkmate, the side that just moved WON. 
                // Stockfish would see "Mate in 0". 
                // From the perspective of the side whose turn it is now (the loser), it is -Infinity.
                evalAfter = { type: 'mate', value: 0 }; 
            } else {
                // Draw (Stalemate, etc)
                evalAfter = { type: 'cp', value: 0 };
            }
            bestMoveAfter = null; // No moves left
            pvAfter = '';
            
            // Prepare next loop iteration (though loop will end)
            currentAnalysis = { evaluation: evalAfter, bestMove: null };
        } else {
            // Normal move: Get engine analysis for the opponent's new position
            const nextAnalysis = await stockfishService.analyzePosition(fenAfterMove);
            evalAfter = nextAnalysis.evaluation;
            bestMoveAfter = nextAnalysis.bestMove;
            pvAfter = nextAnalysis.principalVariation;
            
            // Update currentAnalysis for the NEXT iteration of the loop
            currentAnalysis = nextAnalysis;
        }

        // 5. Calculate Move Quality (Mistake/Blunder)
        let isMistake = false;
        let isBlunder = false;
        let comment = '';

        if (isHumanMove) {
            const cpAfterRaw = getCpValue(evalAfter);
            
            let cpActualResult;
            if (evalAfter.type === 'mate' && evalAfter.value === 0) {
                 cpActualResult = 10000; // Positive because the player WON
            } else {
                 cpActualResult = -1 * cpAfterRaw;
            }

            const evalDiff = cpStart - cpActualResult; 
            // Example: Start +100. Result -200 (Blunder). Diff = 300.

            const MISTAKE_THRESHOLD = 150; // 1.5 pawns
            const BLUNDER_THRESHOLD = 300; // 3 pawns

            if (evalDiff > BLUNDER_THRESHOLD) {
                isBlunder = true;
                comment = `Blunder. You lost significant advantage. Best was ${bestMoveStart}.`;
            } else if (evalDiff > MISTAKE_THRESHOLD) {
                isMistake = true;
                comment = `Mistake. Best move was ${bestMoveStart}.`;
            } else if (evalStart.type === 'mate' && evalAfter.type !== 'mate') {
                 // You had a forced mate sequence and lost it
                 isMistake = true;
                 comment = `Missed Mate. Best move was ${bestMoveStart}.`;
            }
        }

        analysisResults.push({
            moveNumber: Math.floor(i / 2) + 1,
            color: isWhiteTurn ? 'white' : 'black',
            move: moveSan,
            fen: fenAfterMove,
            evaluation: evalStart, // Store what the eval was BEFORE this move (context)
            bestMove: bestMoveStart, // The move the engine recommended
            isMistake,
            isBlunder,
            comment
        });
    }

    await Game.findByIdAndUpdate(
        gameDoc._id,
        { 
            $set: { 
                analysis: analysisResults, 
                status: 'finished' 
            } 
        }
    );

    logger.info(`Game ${gameId} analysis complete.`);
    
    // Return the updated document if needed by the caller
    return await Game.findById(gameDoc._id);
};


/**
 * Retrieves a game by its ID.
 * @param {string} gameId
 * @returns {Promise<Game>} - The game document
 */
const getGameById = async (gameId) => {
    const game = await Game.findOne({ gameId });
    if (!game) {
        throw new Error('Game not found.');
    }
    return game;
};

/**
 * Terminates a game and its associated Stockfish engine.
 * This is useful for cleanup if a user leaves a game or it crashes.
 * @param {string} gameId
 */
const terminateGame = async (gameId) => {
    stockfishService.terminateEngine(gameId);
    activeGames.delete(gameId);
    // Optionally update game status in DB to 'terminated' or similar
    await Game.updateOne({ gameId }, { status: 'terminated', result: '*' });
    logger.info(`Game ${gameId} and its Stockfish engine terminated.`);
};

module.exports = {
    setSocketIo, // Export the setter
    createGame,
    makeMove,
    analyzeGame,
    getGameById,
    getGameHistory,
    terminateGame
};