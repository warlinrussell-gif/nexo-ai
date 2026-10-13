// Hook de electron-builder: incrusta el icono y la información de versión en NexoAI.exe
// usando resedit (JavaScript puro), sin necesidad de Wine al compilar desde Linux/macOS.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { NtExecutable, NtExecutableResource, Resource, Data } = await import('resedit');
  const exeName = (context.packager.platformSpecificBuildOptions.executableName || context.packager.appInfo.productFilename) + '.exe';
  const exePath = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(exePath)) { console.warn('[after-pack] no se encontró', exePath); return; }
  const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);
  const iconFile = Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, iconFile.icons.map((i) => i.data));
  const version = context.packager.appInfo.version.split('.').map((n) => parseInt(n, 10) || 0);
  const vis = Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] || Resource.VersionInfo.createEmpty();
  vi.setFileVersion(version[0], version[1], version[2], 0, 1033);
  vi.setProductVersion(version[0], version[1], version[2], 0, 1033);
  const langs = vi.getAllLanguagesForStringValues();
  const lang = langs[0] || { lang: 1033, codepage: 1200 };
  vi.setStringValues(lang, {
    ProductName: 'Nexo AI', FileDescription: 'Nexo AI', CompanyName: 'Nexo AI', LegalCopyright: 'Nexo AI',
    OriginalFilename: exeName, InternalName: 'NexoAI', FileVersion: context.packager.appInfo.version, ProductVersion: context.packager.appInfo.version
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[after-pack] icono y versión aplicados a', exeName);
};
