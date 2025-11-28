const log = (message, level = 'info') => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
};

const error = (message) => log(message, 'error');
const warn = (message) => log(message, 'warn');
const info = (message) => log(message, 'info');
const debug = (message) => log(message, 'debug');

module.exports = {
    info,
    warn,
    error,
    debug
};