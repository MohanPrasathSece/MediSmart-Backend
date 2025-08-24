console.log('Starting route debugger...');

const routes = [
  './routes/auth.js',
  './routes/users.js',
  './routes/medicines.js',
  './routes/orders.js',
  './routes/prescriptions.js',
  './routes/ai.js',
  './routes/chat.js'
];

routes.forEach(route => {
  try {
    require(route);
    console.log(`Successfully required ${route}`);
  } catch (e) {
    console.error(`Failed to require ${route}:`, e.message);
  }
});

console.log('Route debugger finished.');
