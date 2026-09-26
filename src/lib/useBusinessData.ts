// Deprecated legacy shim.
// This directory is not part of the active application.
// The live frontend lives in phase3-frontend/src.

export function useBusinessData() {
  throw new Error("Legacy root src is deprecated. Use phase3-frontend/src instead.");
}

export default function deprecatedUseBusinessDataShim() {
  return null;
}
