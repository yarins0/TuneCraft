import { Router } from 'express';
import { refreshTokenMiddleware } from '../middleware/refreshToken';
import * as library    from '../controllers/library';
import * as discover   from '../controllers/discover';
import * as tracks     from '../controllers/tracks';
import * as operations from '../controllers/operations';

const router = Router();

// ── Library ───────────────────────────────────────────────────────────────────
router.get('/:userId',              refreshTokenMiddleware, library.getPlaylists);
router.get('/:userId/features',     refreshTokenMiddleware, library.getFeatures);
router.get('/:userId/genres',       refreshTokenMiddleware, library.getGenres);
router.get('/:userId/liked',        refreshTokenMiddleware, library.getLiked);
router.get('/:userId/liked/tracks', refreshTokenMiddleware, library.getLikedTracks);

// ── Discover ──────────────────────────────────────────────────────────────────
router.get('/:userId/discover',             refreshTokenMiddleware, discover.discoverByUrl);
router.get('/:userId/discover/:playlistId', refreshTokenMiddleware, discover.discoverById);

// ── Tracks ────────────────────────────────────────────────────────────────────
router.get( '/:userId/:playlistId/tracks',   refreshTokenMiddleware, tracks.getTracks);
router.post('/:userId/:playlistId/shuffle',  refreshTokenMiddleware, tracks.shuffleTracks);
router.put( '/:userId/:playlistId/save',     refreshTokenMiddleware, tracks.saveTracks);

// ── Operations ────────────────────────────────────────────────────────────────
router.post('/:userId/copy',  refreshTokenMiddleware, operations.copyPlaylist);
router.post('/:userId/merge', refreshTokenMiddleware, operations.mergePlaylist);
router.post('/:userId/split', refreshTokenMiddleware, operations.splitPlaylist);

export default router;
