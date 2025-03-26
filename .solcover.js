module.exports = {
    configureYulOptimizer: true, // (Experimental). Should resolve "stack too deep" in projects using ABIEncoderV2.
    skipFiles: ['comet_migrator_v2_v3/', 'mocks/', 'interfaces/', 'libs/', 'test/'],
    mocha: {
        fgrep: "[skip-on-coverage]",
        invert: true
    }
};