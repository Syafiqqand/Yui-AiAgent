const esbuild = require('esbuild');

async function build() {
  try {
    await esbuild.build({
      entryPoints: ['src/avatar/haru-init.js'],
      bundle: true,
      outfile: 'src/avatar/haru-bundle.js',
      format: 'iife',
      globalName: 'HaruAvatarBundle',
      platform: 'browser',
      target: 'es2020',
      define: {
        'process.env.NODE_ENV': '"production"',
      },
      mainFields: ['module', 'main'],
      conditions: ['browser', 'module', 'import'],
      logLevel: 'verbose',
    });
    console.log('Build successful: src/avatar/haru-bundle.js');
  } catch (err) {
    console.error('Build failed:', JSON.stringify(err, null, 2));
    process.exit(1);
  }
}

build();