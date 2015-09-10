var dts = require('dts-bundle');
dts.bundle({
  name: require('./package').name,
  // main: require('.package').typescript.name
  // TODO: move to build directory
  main: './src/config.d.ts'
});
