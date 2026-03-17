import { startReshuffleCron } from './reshuffle';
import { startCleanupCron } from './cleanup';

// Starts all background cron jobs. Called once when the server boots.
export const startCrons = (): void => {
  startReshuffleCron();
  startCleanupCron();
  console.log('✅ Cron jobs started');
};
