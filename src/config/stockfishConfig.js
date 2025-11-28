/**
 * Defines Stockfish configurations for 10 difficulty levels.
 *
 * Stockfish UCI Options relevant for difficulty:
 * - Skill Level (0-20): Higher values mean stronger play.
 * - UCI_LimitStrength (true/false): If true, Stockfish will play at a specific ELO.
 * - UCI_Elo (400-13200+): The target ELO when UCI_LimitStrength is true.
 * - Move overhead (ms): Simulates human thinking time.
 * - Slowmover (ms): Introduces variability in move time.
 * - Contempt (-100 to 100): How much Stockfish avoids draws.
 * - Threads (1-128): Number of CPU threads for calculation.
 * - Hash (MB): Transposition table size.
 */
const stockfishDifficultyLevels = {
    1: { skillLevel: 0, depth: 1, movetime: 1000, elo: 800, contempt: -100 },
    2: { skillLevel: 2, depth: 2, movetime: 100, elo: 1000, contempt: -75 },
    3: { skillLevel: 4, depth: 3, movetime: 150, elo: 1200, contempt: -50 },
    4: { skillLevel: 6, depth: 4, movetime: 200, elo: 1400, contempt: -25 },
    5: { skillLevel: 8, depth: 5, movetime: 250, elo: 1600, contempt: 0 },
    6: { skillLevel: 10, depth: 6, movetime: 300, elo: 1800, contempt: 25 },
    7: { skillLevel: 12, depth: 8, movetime: 400, elo: 2000, contempt: 50 },
    8: { skillLevel: 14, depth: 10, movetime: 500, elo: 2200, contempt: 75 },
    9: { skillLevel: 16, depth: 12, movetime: 750, elo: 2400, contempt: 100 },
    10: { skillLevel: 20, depth: 15, movetime: 1000, elo: 3000, contempt: 100 } // Max strength for skill level, higher depth/movetime
};

// Function to get UCI options for a given difficulty level
const getStockfishOptionsForDifficulty = (level) => {
    const config = stockfishDifficultyLevels[level];
    if (!config) {
        throw new Error(`Invalid difficulty level: ${level}. Must be between 1 and 10.`);
    }

    const options = [
        `setoption name Skill Level value ${config.skillLevel}`,
        `setoption name UCI_LimitStrength value true`, // Enable ELO limiting
        `setoption name UCI_Elo value ${config.elo}`,
        `setoption name Contempt value ${config.contempt}`
    ];
    return {
        options,
        searchParams: `go depth ${config.depth} movetime ${config.movetime}`
    };
};

module.exports = {
    getStockfishOptionsForDifficulty,
    stockfishDifficultyLevels // Export for reference
};