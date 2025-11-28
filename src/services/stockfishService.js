// src/services/stockfishService.js (Updated for direct UCI)
const { spawn } = require('child_process');
const logger = require('../utils/logger');
const { getStockfishOptionsForDifficulty } = require('../config/stockfishConfig');
require('dotenv').config();

const STOCKFISH_PATH = process.env.STOCKFISH_PATH;
if (!STOCKFISH_PATH) {
    logger.error('STOCKFISH_PATH is not defined in .env file. Please specify the path to your Stockfish executable.');
    process.exit(1);
}

// Map to store active Stockfish child processes
const stockfishProcesses = new Map(); // gameId -> { process: ChildProcess, responseQueue: [], resolve: Function, reject: Function }

/**
 * Sends a command to the Stockfish engine and waits for a specific response or 'readyok'.
 * @param {ChildProcess} engineProcess
 * @param {string} command
 * @param {string} expectedResponseEnd - The string that indicates the end of the response (e.g., 'readyok', 'bestmove', 'No moves to consider')
 * @returns {Promise<string>} - The full response from the engine until the expected string is found.
 */
const sendCommandAndAwaitResponse = (engineProcess, command, expectedResponseEnd) => {
    return new Promise((resolve, reject) => {
        let responseBuffer = '';
        const timeout = setTimeout(() => {
            logger.error(`Stockfish command timed out for command: ${command}`);
            engineProcess.removeListener('data', dataListener); // Clean up listener
            reject(new Error(`Stockfish command timed out: ${command}`));
        }, 10000); // 10 seconds timeout for general commands

        const dataListener = (data) => {
            const dataString = data.toString().trim();
            responseBuffer += dataString + '\n';
            logger.debug(`Stockfish received for command "${command}": ${dataString}`);

            if (dataString.includes(expectedResponseEnd)) {
                clearTimeout(timeout);
                engineProcess.removeListener('data', dataListener);
                resolve(responseBuffer);
            }
        };

        engineProcess.stdout.on('data', dataListener);
        engineProcess.stderr.on('data', (data) => logger.error(`Stockfish STDERR: ${data.toString()}`));

        engineProcess.stdin.write(`${command}\n`);
        logger.debug(`Stockfish sent: ${command}`);
    });
};

/**
 * Initializes a Stockfish engine for a given gameId.
 * @param {string} gameId
 * @param {number} difficulty - Difficulty level 1-10
 */
const initializeEngine = async (gameId, difficulty = 5) => {
    if (stockfishProcesses.has(gameId)) {
        logger.warn(`Stockfish engine already exists for game ${gameId}. Terminating old instance.`);
        terminateEngine(gameId);
    }

    try {
        // Spawn the Stockfish executable
        const engineProcess = spawn(STOCKFISH_PATH);
        stockfishProcesses.set(gameId, { process: engineProcess, responseBuffer: '' });

        // UCI setup:
        // 1. Send 'uci' command and wait for 'uciok'
        await sendCommandAndAwaitResponse(engineProcess, 'uci', 'uciok');
        logger.info(`Stockfish engine for game ${gameId} initialized (UCI OK).`);

        // 2. Set difficulty options
        const { options } = getStockfishOptionsForDifficulty(difficulty);
        for (const option of options) {
            engineProcess.stdin.write(`${option}\n`);
            logger.debug(`Sent Stockfish option for ${gameId}: ${option}`);
        }
        
        // 3. Send 'isready' command and wait for 'readyok'
        await sendCommandAndAwaitResponse(engineProcess, 'isready', 'readyok');
        logger.info(`Stockfish engine for game ${gameId} is ready after setting options.`);

        // 4. Send 'ucinewgame' command
        engineProcess.stdin.write('ucinewgame\n');

        // 5. Send another 'isready' command and wait for 'readyok' to confirm new game state is ready
        await sendCommandAndAwaitResponse(engineProcess, 'isready', 'readyok');
        logger.info(`Stockfish engine for ${gameId} is ready for a new game with difficulty ${difficulty}.`);

    } catch (error) {
        logger.error(`Error initializing Stockfish for game ${gameId}: ${error.message}`);
        // Ensure process is killed if initialization fails
        if (stockfishProcesses.has(gameId)) {
            stockfishProcesses.get(gameId).process.kill();
            stockfishProcesses.delete(gameId);
        }
        throw new Error('Failed to initialize Stockfish engine.');
    }
};

/**
 * Gets the best move from Stockfish for a given FEN.
 * @param {string} gameId
 * @param {string} fen
 * @param {number} difficulty - Difficulty level (used to retrieve search parameters)
 * @returns {Promise<{bestMove: string, ponder?: string, evaluation: {type: string, value: number}, principalVariation: string}>}
 */
const getBestMove = async (gameId, fen, difficulty) => {
    const engineEntry = stockfishProcesses.get(gameId);
    if (!engineEntry) {
        throw new Error(`Stockfish engine not found for game ${gameId}.`);
    }
    const engineProcess = engineEntry.process;

    const { searchParams } = getStockfishOptionsForDifficulty(difficulty);

    return new Promise(async (resolve, reject) => {
        let bestMove = null;
        let ponder = null;
        let evaluation = { type: 'cp', value: 0 };
        let principalVariation = '';

        const timeout = setTimeout(() => {
            logger.warn(`Stockfish for game ${gameId} timed out getting move for FEN: ${fen}`);
            // Force engine to stop thinking
            engineProcess.stdin.write('stop\n');
            // Give it a moment to output the last bestmove before rejecting
            setTimeout(() => {
                reject(new Error("Stockfish move calculation timed out."));
            }, 500); // Wait 0.5 sec for final output
        }, 15000); // 15 seconds timeout

        // Listener for all data
        const dataListener = (data) => {
            const dataString = data.toString();
            engineEntry.responseBuffer += dataString; // Accumulate response
            logger.debug(`Stockfish for ${gameId} raw data: ${dataString.trim()}`);

            // Parse info strings for evaluation and PV
            const infoMatches = dataString.match(/info depth (\d+) seldepth \d+ multipv \d+ score (cp|mate) (-?\d+)(?: nodes \d+ nps \d+ hashfull \d+ tbhits \d+ time \d+ pv (.+))?/g);
            if (infoMatches) {
                // Take the last info line, which should be the deepest/most recent
                const lastInfoMatch = infoMatches[infoMatches.length - 1].match(/info depth (\d+) seldepth \d+ multipv \d+ score (cp|mate) (-?\d+)(?: nodes \d+ nps \d+ hashfull \d+ tbhits \d+ time \d+ pv (.+))?/);
                if (lastInfoMatch) {
                    const [_, depth, scoreType, scoreValue, pvString] = lastInfoMatch;
                    evaluation = { type: scoreType, value: parseInt(scoreValue, 10) };
                    if (pvString) {
                        principalVariation = pvString.trim();
                    }
                }
            }

            // Parse bestmove
            const bestMoveMatch = dataString.match(/^bestmove ([a-h][1-8][a-h][1-8])(?: ([a-h][1-8][a-h][1-8]))?/m); // 'm' for multi-line search
            if (bestMoveMatch) {
                bestMove = bestMoveMatch[1];
                ponder = bestMoveMatch[2]; // Optional ponder move
                clearTimeout(timeout);
                engineProcess.stdout.removeListener('data', dataListener); // Remove listener to prevent memory leaks
                resolve({ bestMove, ponder, evaluation, principalVariation });
            }
        };

        engineProcess.stdout.on('data', dataListener);
        engineProcess.stdin.write(`position fen ${fen}\n`);
        engineProcess.stdin.write(`${searchParams}\n`);
        logger.info(`Stockfish for game ${gameId} searching for move for FEN: ${fen} with params: ${searchParams}`);
    });
};

/**
 * Analyzes a given FEN position to get evaluation and best move.
 * This function will typically run with higher depth/movetime for analysis.
 * @param {string} fen
 * @returns {Promise<{evaluation: {type: string, value: number}, bestMove: string, principalVariation: string}>}
 */
const analyzePosition = async (fen) => {
    // For analysis, we will spawn a new temporary Stockfish instance.
    // This isolates analysis from active games.
    let analysisEngineProcess = null;
    try {
        analysisEngineProcess = spawn(STOCKFISH_PATH);
        await sendCommandAndAwaitResponse(analysisEngineProcess, 'uci', 'uciok');
        await sendCommandAndAwaitResponse(analysisEngineProcess, 'isready', 'readyok');

        let evaluation = { type: 'cp', value: 0 };
        let bestMove = '';
        let principalVariation = '';

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                logger.error(`Stockfish analysis timed out for FEN: ${fen}`);
                analysisEngineProcess.kill(); // Crucial to terminate
                reject(new Error("Stockfish analysis timed out."));
            }, 30000); // Longer timeout for deeper analysis (e.g., 30 seconds)

            const dataListener = (data) => {
                const dataString = data.toString();
                logger.debug(`Analysis raw data: ${dataString.trim()}`);

                const infoMatches = dataString.match(/info depth (\d+) seldepth \d+ multipv \d+ score (cp|mate) (-?\d+)(?: nodes \d+ nps \d+ hashfull \d+ tbhits \d+ time \d+ pv (.+))?/g);
                if (infoMatches) {
                    const lastInfoMatch = infoMatches[infoMatches.length - 1].match(/info depth (\d+) seldepth \d+ multipv \d+ score (cp|mate) (-?\d+)(?: nodes \d+ nps \d+ hashfull \d+ tbhits \d+ time \d+ pv (.+))?/);
                    if (lastInfoMatch) {
                        const [_, depth, scoreType, scoreValue, pvString] = lastInfoMatch;
                        evaluation = { type: scoreType, value: parseInt(scoreValue, 10) };
                        if (pvString) {
                            principalVariation = pvString.trim();
                        }
                    }
                }

                const bestMoveMatch = dataString.match(/^bestmove ([a-h][1-8][a-h][1-8])(?: ([a-h][1-8][a-h][1-8]))?/m);
                if (bestMoveMatch) {
                    bestMove = bestMoveMatch[1];
                    clearTimeout(timeout);
                    analysisEngineProcess.stdout.removeListener('data', dataListener);
                    analysisEngineProcess.kill(); // Important: terminate the temporary engine
                    resolve({ evaluation, bestMove, principalVariation });
                }
            };
            analysisEngineProcess.stdout.on('data', dataListener);

            analysisEngineProcess.stdin.write(`position fen ${fen}\n`);
            analysisEngineProcess.stdin.write('go depth 20\n'); // Deeper analysis depth
            logger.info(`Stockfish analyzing FEN: ${fen} with depth 20`);
        });
    } catch (error) {
        logger.error(`Failed to spawn or initialize analysis Stockfish process: ${error.message}`);
        if (analysisEngineProcess) {
            analysisEngineProcess.kill(); // Ensure it's killed on spawn/init error
        }
        throw error;
    }
};


/**
 * Terminates a Stockfish engine for a given gameId.
 * @param {string} gameId
 */
const terminateEngine = (gameId) => {
    const engineEntry = stockfishProcesses.get(gameId);
    if (engineEntry) {
        engineEntry.process.kill(); // Send SIGTERM
        stockfishProcesses.delete(gameId);
        logger.info(`Stockfish engine for game ${gameId} terminated.`);
    }
};

module.exports = {
    initializeEngine,
    getBestMove,
    analyzePosition,
    terminateEngine
};