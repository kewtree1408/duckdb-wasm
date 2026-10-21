// Requires a matching loadable base build with the local AWS extension.
const base = require('./karma.base.cjs');

module.exports = config => {
    const cfg = base(config);
    config.set({
        ...cfg,
        frameworks: ['jasmine'],
        files: [
            { pattern: 'packages/duckdb-wasm/dist/tests-aws.js' },
            { pattern: 'packages/duckdb-wasm/dist/*.wasm', included: false, watched: false },
            { pattern: 'packages/duckdb-wasm/dist/*.js', included: false, watched: false },
            { pattern: 'build/extension_repository/**/*.wasm', included: false, watched: false },
        ],
        preprocessors: {},
        reporters: ['spec'],
        client: { jasmine: { failFast: false, random: false, timeoutInterval: 100000 } },
        captureTimeout: 60000,
        browserDisconnectTimeout: 10000,
        browserDisconnectTolerance: 0,
        browserNoActivityTimeout: 110000,
        processKillTimeout: 10000,
    });
};
