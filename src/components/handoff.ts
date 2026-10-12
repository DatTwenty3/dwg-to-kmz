// Files handed from one page to another on client-side navigation (module state survives a <Link>/router.push):
// "Bóc tách DWG → TT16" opens its HoSoGIS.zip in the checker without the user picking it again.
let pending: File[] | null = null;

export function handOffToChecker(files: File[]) {
  pending = files;
}

/** The handed-off files (kept until cleared: effects may run twice in development). */
export const peekCheckerHandoff = () => pending;
export function clearCheckerHandoff() {
  pending = null;
}
