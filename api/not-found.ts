import type { Request, Response } from 'express';

/** Vercel rewrite target for deployment artifacts that must never reach the SPA fallback. */
export default (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Not Found' });
};
