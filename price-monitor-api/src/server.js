require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');

const port = process.env.PORT || 3000;

async function start() {
  const demoMode = process.env.DEMO_MODE === 'true';
  if (!demoMode) {
    if (!process.env.MONGODB_URI) throw new Error('A variável MONGODB_URI não foi configurada.');
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET) {
      throw new Error('Configure ADMIN_USERNAME, ADMIN_PASSWORD e JWT_SECRET.');
    }
    await mongoose.connect(process.env.MONGODB_URI);
  }
  app.listen(port, () => console.log(`API disponível na porta ${port}${demoMode ? ' (modo demonstração)' : ''}`));
}

start().catch((error) => {
  console.error('Falha ao iniciar a aplicação:', error.message);
  process.exit(1);
});
