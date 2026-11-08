// Test support. Relative imports in the sources name `.js` files that are
// `.ts` on disk. And `@asset-studio/studio` is not a declared dependency of
// the cli (Bob's ruling), so the test points that name at the workspace
// source, the way an install would place the package next to the cli.
const studio = new URL("../index.ts", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@asset-studio/studio") {
    return { url: studio, shortCircuit: true };
  }
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code === "ERR_MODULE_NOT_FOUND" &&
      specifier.startsWith(".") &&
      specifier.endsWith(".js")
    ) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
