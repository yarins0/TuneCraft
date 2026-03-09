import { PrismaClient } from '@prisma/client';

// A single shared instance of PrismaClient used across the entire application.
// Creating multiple instances would exhaust the database connection pool.
const prisma = new PrismaClient();

export default prisma;