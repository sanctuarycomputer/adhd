import type { FigmaLike } from "../src/figma/extract";

// Builds a FigmaLike from a recorded document (see test/recordings/tokens-doc.json).
// Mirrors the shape of the real figma plugin API's variables/style accessors closely
// enough to exercise runExtract's cursor protocol without touching the network or a
// real Figma document.
export function fakeFigma(doc: any): FigmaLike {
  const allVars = new Map<string, any>();
  for (const c of doc.collections) for (const v of c.variables) allVars.set(v.id, { ...v, variableCollectionId: c.id });
  return {
    variables: {
      getLocalVariableCollectionsAsync: async () => doc.collections.map((c: any) => ({
        id: c.id, name: c.name, modes: c.modes, variableIds: c.variables.map((v: any) => v.id),
      })),
      getVariableByIdAsync: async (id: string) => allVars.get(id) ?? null,
    },
    getLocalTextStylesAsync: async () => doc.textStyles,
    getLocalEffectStylesAsync: async () => doc.effectStyles,
  };
}
