// Single source of truth lives in shared/shuffleAlgorithms.ts at the repo root.
// This file re-exports everything from there so existing server imports continue
// to work without any changes — callers still write:
//   import { applyShuffle } from './shuffleAlgorithms'
export * from '../../../shared/shuffleAlgorithms';
