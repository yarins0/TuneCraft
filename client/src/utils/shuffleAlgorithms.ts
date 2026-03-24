// Single source of truth lives in shared/shuffleAlgorithms.ts at the repo root.
// This file re-exports everything from there so existing client imports continue
// to work without any changes — callers still write:
//   import { applyShuffle } from '../utils/shuffleAlgorithms'
//
// The shared algorithms use generics (<T extends ShuffleTrack>) so passing the
// full client Track type in returns the full Track type back — no information lost.
export * from '../../../shared/shuffleAlgorithms';
