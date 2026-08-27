import express from 'express';
import helmet from 'helmet';
import extractionRoute from './extractionRoute';
import accountRoute from './accountRoute';

const app = express();

// Keep helmet CSP directives and headers synchronized; allow framing for preview environment
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://apis.google.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:", "https://lh3.googleusercontent.com", "https://firebasestorage.googleapis.com", "https://*.googleusercontent.com"],
      connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com", "wss://*.firebaseio.com", "https://securetoken.googleapis.com", "https://identitytoolkit.googleapis.com"],
      fontSrc: ["'self'", "data:"],
      workerSrc: ["'self'", "blob:"],
      frameSrc: ["'self'", "https://*.firebaseapp.com"],
      frameAncestors: ["*"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  xFrameOptions: false
}));

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }
  next();
});

// Protect server files and env
app.use((req, res, next) => {
  const protectedPaths = ['/.env', '/server.ts', '/server.cjs', '/dist/server.cjs'];
  if (protectedPaths.includes(req.path) || req.path.startsWith('/.env')) {
    return res.status(404).json({ error: 'Not Found' });
  }
  next();
});


// Add the API routes
app.use('/api', extractionRoute);
app.use('/api/account', accountRoute);
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', runtime: 'vercel-compatible' });
});



app.all('/api/*', (req, res) => res.status(404).json({ error: 'Not Found' }));

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server Error:', err.message);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload Too Large' });
  }
  res.status(500).json({ error: 'Internal Server Error' });
});

export default app;
