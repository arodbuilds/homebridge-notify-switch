/** SVG files are inlined as text by esbuild (scripts/build-ui.mjs); the settings UI imports the brand mark this way. */
declare module '*.svg' {
  const content: string;
  export default content;
}
