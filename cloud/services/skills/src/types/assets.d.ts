// Bundled skill assets are imported as raw text via the wrangler `[[rules]]`
// Text module rule on **/*.md. Each import resolves to the file's string content.
declare module "*.md" {
  const content: string;
  export default content;
}
