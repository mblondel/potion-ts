// Builds the tutorial into self-contained HTML:
//   docs/index.html               a complete page, ready for GitHub Pages (serve from /docs)
//   dist/potion-tutorial.html     the same page without <html>/<head>, for embedding
const bundle = async (entry: string) => {
  const r = await Bun.build({ entrypoints: [entry], minify: true, target: "browser", format: "iife" });
  if (!r.success) { console.error(r.logs); process.exit(1); }
  return (await r.outputs[0].text()).replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
};

const worker = await bundle("src/worker.ts");
const ui = await bundle("src/book.ts");
const fragment = (await Bun.file("web/book.html").text())
  .replace("<!--WORKER-->", () => worker)
  .replace("<!--UI-->", () => ui);
await Bun.write("dist/potion-tutorial.html", fragment);

// Everything before the layout belongs in <head>; the rest is the body.
const split = fragment.indexOf('<div class="layout">');
const head = fragment.slice(0, split).replace(/<meta name="claude:[^>]*>\n?/, "").trim();
const body = fragment.slice(split).trim();
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="A runnable, chapter-by-chapter tutorial of _why the lucky stiff's Potion language, reimplemented in TypeScript.">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
await Bun.write("docs/index.html", page);
console.log(`docs/index.html ${(page.length / 1024).toFixed(1)} KB`);
