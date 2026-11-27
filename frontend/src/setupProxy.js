const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');

module.exports = function(app) {
  // محاولة قراءة الآي بي الديناميكي من الملف المولد بواسطة الباك-إند
  let targetIp = 'localhost';
  let targetPort = '5000';
  try {
    const configPath = path.join(__dirname, 'backend_config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.BACKEND_IP) {
        targetIp = config.BACKEND_IP;
      }
      if (config.BACKEND_PORT) {
        targetPort = config.BACKEND_PORT;
      }
      console.log(`🔗 Proxy targeting dynamic backend: http://${targetIp}:${targetPort}`);
    }
  } catch (err) {
    console.error('⚠️ Could not load backend_config.json for proxy:', err.message);
  }

  const target = `http://${targetIp}:${targetPort}`;

  // فقط أي طلب يبدأ بـ /api يروح للباك-إند
  app.use(
    '/api',
    createProxyMiddleware({
      target: target,
      changeOrigin: true,
    })
  );
  // للملفات الثابتة مثل الصور
  app.use(
    '/uploads',
    createProxyMiddleware({
      target: target,
      changeOrigin: true,
    })
  );
  // لو عندك socket.io
  app.use(
    '/socket.io',
    createProxyMiddleware({
      target: 'http://localhost:5000',
      ws: true,
      changeOrigin: true,
    })
  );
};

