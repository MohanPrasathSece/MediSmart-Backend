console.log('Attempting to start server...');
try {
  require('./server.js');
  console.log('Server script executed without crashing.');
} catch (e) {
  console.error('!!! FAILED TO START SERVER !!!');
  console.error(e);
  process.exit(1);
}
