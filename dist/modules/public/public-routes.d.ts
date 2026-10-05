import { Router } from 'express';
import type { DatabaseConnection } from '../../core/db/database.js';
export declare function createPublicRouter(database: DatabaseConnection): Router;
