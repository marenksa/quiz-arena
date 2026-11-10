// The single serverless entry point. vercel.json rewrites /api/* here.
import { handle } from '../lib/routes.js';

export const GET = handle;
export const POST = handle;
