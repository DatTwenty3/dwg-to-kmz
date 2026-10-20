// Files handed from one page to another on client-side navigation (module state survives a <Link>/router.push):
// - "Bóc tách DWG → TT16" opens its HoSoGIS.zip in the checker without the user picking it again;
// - the home page takes one drop for every tool and hands it to the tool that reads it.
// Each slot is kept until its page clears it (effects may run twice in development).
export type HandoffPicked = { path: string; file: File };

let checker: File[] | null = null;
let map: File[] | null = null;
let extractor: HandoffPicked[] | null = null;

export const handOffToChecker = (files: File[]) => {
  checker = files;
};
export const peekCheckerHandoff = () => checker;
export const clearCheckerHandoff = () => {
  checker = null;
};

export const handOffToMap = (files: File[]) => {
  map = files;
};
export const peekMapHandoff = () => map;
export const clearMapHandoff = () => {
  map = null;
};

export const handOffToExtractor = (files: HandoffPicked[]) => {
  extractor = files;
};
export const peekExtractorHandoff = () => extractor;
export const clearExtractorHandoff = () => {
  extractor = null;
};
