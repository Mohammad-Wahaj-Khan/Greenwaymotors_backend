import pino from 'pino';
import type { Environment } from '../../config/env.js';
export declare function createLogger(environment: Environment): pino.Logger;
