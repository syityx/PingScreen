const { build } = require('./package.json');
module.exports = {
  ...build,
  appId: 'com.pingscreen.demo',
  directories: { ...build.directories, output: 'release/demo' },
  extraMetadata: { demo: true },
  artifactName: 'pingscreen-Demo-${version}.${ext}',
  extraFiles: [{ from: 'docs/demo-readme.txt', to: 'DEMO-使用说明.txt' }],
  win: { ...build.win, target: [{ target: 'zip', arch: ['x64'] }] },
};
