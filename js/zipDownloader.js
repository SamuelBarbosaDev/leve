const JSZIP_VERSION = "3.10.1";

let jszipPromise = null;

async function getJSZip() {
  if (!jszipPromise) {
    jszipPromise = import(
      `https://cdn.jsdelivr.net/npm/jszip@${JSZIP_VERSION}/+esm`
    ).then((mod) => mod.default ?? mod.JSZip ?? mod);
  }
  return jszipPromise;
}

function dedupeName(name, usedNames) {
  const count = usedNames.get(name) ?? 0;
  usedNames.set(name, count + 1);
  if (count === 0) return name;

  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex === -1 ? name : name.slice(0, dotIndex);
  const ext = dotIndex === -1 ? "" : name.slice(dotIndex);
  return `${base} (${count})${ext}`;
}

export async function createZip(entries) {
  const JSZip = await getJSZip();
  const zip = new JSZip();
  const usedNames = new Map();

  for (const { name, blob } of entries) {
    zip.file(dedupeName(name, usedNames), blob);
  }

  return zip.generateAsync({ type: "blob" });
}
