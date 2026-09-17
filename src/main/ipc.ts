import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  shell,
} from 'electron';
import Store from 'electron-store';
import { createReadStream, createWriteStream, WriteStream } from 'fs';
import path from 'path';
import { copyFile, mkdir, readFile, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import getSdCards, { additionalIsoRelativePath, writeNincfg } from './sd';
import isValidISO, { isValidGameCubeISO } from './iso';
import eject from './eject';
import { AdditionalIso, Config, SdCard, Video } from '../common/types';
import { DEFAULT_CONFIG } from '../common/constants';

const highWaterMark = 1024 * 1024;
const forwarderRootPath = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'forwarder')
  : path.join(__dirname, '..', '..', 'assets', 'forwarder');
const slippiNintendontRootPath = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'slippiNintendont')
  : path.join(__dirname, '..', '..', 'assets', 'slippiNintendont');
const xmlParser = new XMLParser({ parseTagValue: false });

async function getSlippiNintendontVersion(slippiNintendontPath: string) {
  const metaXmlBuffer = await readFile(
    path.join(slippiNintendontPath, 'meta.xml'),
  );
  const metaObj = xmlParser.parse(metaXmlBuffer);
  if (metaObj?.app?.name !== 'Slippi Nintendont') {
    throw new Error('bundled meta.xml app name');
  }

  const { version } = metaObj.app;
  if (typeof version !== 'string') {
    throw new Error('bundled meta.xml app version');
  }
  return version;
}

export default async function setupIPC(mainWindow: BrowserWindow) {
  const store = new Store<{
    codePath: string;
    config: Config;
    isoPath: string;
    additionalIsoPaths: AdditionalIso[];
  }>();

  let isoPath = store.get('isoPath', '');
  ipcMain.removeAllListeners('getIsoPath');
  ipcMain.handle('getIsoPath', () => isoPath);
  ipcMain.removeAllListeners('chooseIsoPath');
  ipcMain.handle('chooseIsoPath', async () => {
    const openDialogRes = await dialog.showOpenDialog({
      filters: [
        {
          name: 'Melee ISO',
          extensions: ['iso'],
        },
      ],
      properties: ['openFile', 'showHiddenFiles'],
    });
    if (openDialogRes.canceled) {
      return isoPath;
    }
    const [newIsoPath] = openDialogRes.filePaths;
    if (!(await isValidISO(newIsoPath))) {
      throw new Error('ISO game code not GALE01, GALJ01, or GALP01');
    }
    store.set('isoPath', newIsoPath);
    isoPath = newIsoPath;
    return isoPath;
  });

  // Additional ISOs aren't necessarily Melee (e.g. a different GameCube
  // game, or a modded build). They're copied onto SD cards purely so
  // Nintendont can list them, and never participate in autoboot or the
  // cheats/.gct pipeline, which stay wired to the single primary Melee ISO
  // above.
  let additionalIsoPaths = store.get('additionalIsoPaths', []);
  ipcMain.removeAllListeners('getAdditionalIsoPaths');
  ipcMain.handle('getAdditionalIsoPaths', () => additionalIsoPaths);
  ipcMain.removeAllListeners('addAdditionalIsoPaths');
  ipcMain.handle('addAdditionalIsoPaths', async () => {
    const openDialogRes = await dialog.showOpenDialog({
      filters: [
        {
          name: 'GameCube ISO',
          extensions: ['iso'],
        },
      ],
      properties: ['openFile', 'multiSelections', 'showHiddenFiles'],
    });
    if (openDialogRes.canceled) {
      return additionalIsoPaths;
    }

    const invalidPaths: string[] = [];
    const newEntries: AdditionalIso[] = [];
    await Promise.all(
      openDialogRes.filePaths.map(async (newPath) => {
        if (await isValidGameCubeISO(newPath)) {
          newEntries.push({ id: randomUUID(), path: newPath });
        } else {
          invalidPaths.push(newPath);
        }
      }),
    );

    if (newEntries.length > 0) {
      additionalIsoPaths = [...additionalIsoPaths, ...newEntries];
      store.set('additionalIsoPaths', additionalIsoPaths);
    }
    if (invalidPaths.length > 0) {
      throw new Error(`Not a valid GameCube ISO: ${invalidPaths.join(', ')}`);
    }
    return additionalIsoPaths;
  });
  ipcMain.removeAllListeners('removeAdditionalIsoPath');
  ipcMain.handle(
    'removeAdditionalIsoPath',
    (event: IpcMainInvokeEvent, id: string) => {
      additionalIsoPaths = additionalIsoPaths.filter(
        (additionalIso) => additionalIso.id !== id,
      );
      store.set('additionalIsoPaths', additionalIsoPaths);
      return additionalIsoPaths;
    },
  );

  let customSlippiNintendontPath = store.get('customSlippiNintendontPath', '');
  let slippiNintendontVersion = await getSlippiNintendontVersion(
    customSlippiNintendontPath || slippiNintendontRootPath,
  );
  ipcMain.removeAllListeners('getSlippiNintendontPath');
  ipcMain.handle('getSlippiNintendontPath', () => customSlippiNintendontPath);
  ipcMain.removeAllListeners('chooseSlippiNintendontPath');
  ipcMain.handle('chooseSlippiNintendontPath', async () => {
    const openDialogRes = await dialog.showOpenDialog({
      properties: ['openDirectory', 'showHiddenFiles'],
    });
    if (openDialogRes.canceled) {
      return customSlippiNintendontPath;
    }
    const [newCustomSlippiNintendontPath] = openDialogRes.filePaths;
    slippiNintendontVersion = await getSlippiNintendontVersion(
      newCustomSlippiNintendontPath,
    );

    store.set('customSlippiNintendontPath', newCustomSlippiNintendontPath);
    customSlippiNintendontPath = newCustomSlippiNintendontPath;
    return customSlippiNintendontPath;
  });
  ipcMain.removeAllListeners('resetSlippiNintendontPath');
  ipcMain.handle('resetSlippiNintendontPath', async () => {
    slippiNintendontVersion = await getSlippiNintendontVersion(
      slippiNintendontRootPath,
    );

    store.set('customSlippiNintendontPath', '');
    customSlippiNintendontPath = '';
    return customSlippiNintendontPath;
  });

  let codePath = store.get('codePath', '');
  ipcMain.removeAllListeners('getCodePath');
  ipcMain.handle('getCodePath', () => codePath);
  ipcMain.removeAllListeners('chooseCodePath');
  ipcMain.handle('chooseCodePath', async () => {
    const openDialogRes = await dialog.showOpenDialog({
      filters: [{ name: 'Gecko Code File', extensions: ['gct'] }],
      properties: ['openFile', 'showHiddenFiles'],
    });
    if (openDialogRes.canceled) {
      return codePath;
    }
    const [newCodePath] = openDialogRes.filePaths;
    store.set('codePath', newCodePath);
    codePath = newCodePath;
    return codePath;
  });
  ipcMain.removeAllListeners('resetCodePath');
  ipcMain.handle('resetCodePath', () => {
    store.set('codePath', '');
    codePath = '';
    return codePath;
  });

  let config = store.get('config', DEFAULT_CONFIG);
  if (!config.video) {
    config.video = Video.AUTO;
  }
  if (typeof config.stealthAutoBoot !== 'boolean') {
    config.stealthAutoBoot = true;
  }
  ipcMain.removeAllListeners('getConfig');
  ipcMain.handle('getConfig', () => config);
  ipcMain.removeAllListeners('setConfig');
  ipcMain.handle(
    'setConfig',
    (event: IpcMainInvokeEvent, newConfig: Config) => {
      config = newConfig;
      store.set('config', config);
    },
  );

  ipcMain.removeAllListeners('getSdCards');
  ipcMain.handle('getSdCards', () => getSdCards(additionalIsoPaths));

  let forwarderVersion = '';
  ipcMain.removeAllListeners('getForwarderVersion');
  ipcMain.handle('getForwarderVersion', async () => {
    if (forwarderVersion) {
      return forwarderVersion;
    }

    const metaXmlBuffer = await readFile(
      path.join(forwarderRootPath, 'meta.xml'),
    );
    const metaObj = xmlParser.parse(metaXmlBuffer);
    if (metaObj?.app?.name !== 'Forwarder for Slippi Nintendont') {
      throw new Error('bundled meta.xml app name');
    }

    const { version } = metaObj.app;
    if (typeof version !== 'string') {
      throw new Error('bundled meta.xml app version');
    }

    forwarderVersion = version;
    return version;
  });

  ipcMain.removeAllListeners('getSlippiNintendontVersion');
  ipcMain.handle('getSlippiNintendontVersion', () => slippiNintendontVersion);

  const keyToProgress = new Map<
    string,
    { size: number; writeStream: WriteStream }
  >();
  ipcMain.removeAllListeners('copyIso');
  ipcMain.handle(
    'copyIso',
    async (event: IpcMainInvokeEvent, sdCard: SdCard) => {
      if (!isoPath) {
        throw new Error('Set Melee ISO path...');
      }

      const { size } = await stat(isoPath);
      const readStream = createReadStream(isoPath, { highWaterMark });
      await mkdir(path.join(sdCard.key, 'games'), { recursive: true });
      const writeStream = createWriteStream(
        path.join(sdCard.key, 'games', 'melee102.iso'),
        { highWaterMark },
      );
      keyToProgress.set(sdCard.key, { size, writeStream });

      return new Promise<void>((resolve, reject) => {
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('close', resolve);
        readStream.pipe(writeStream);
      });
    },
  );
  ipcMain.removeAllListeners('copyAdditionalIso');
  ipcMain.handle(
    'copyAdditionalIso',
    async (event: IpcMainInvokeEvent, sdCard: SdCard, id: string) => {
      const additionalIso = additionalIsoPaths.find((entry) => entry.id === id);
      if (!additionalIso) {
        throw new Error('Additional ISO not found in configured list');
      }

      const progressKey = `${sdCard.key}#${id}`;
      const { size } = await stat(additionalIso.path);
      const readStream = createReadStream(additionalIso.path, {
        highWaterMark,
      });
      const dstPath = path.join(sdCard.key, additionalIsoRelativePath(id));
      await mkdir(path.dirname(dstPath), { recursive: true });
      const writeStream = createWriteStream(dstPath, { highWaterMark });
      keyToProgress.set(progressKey, { size, writeStream });

      return new Promise<void>((resolve, reject) => {
        readStream.on('error', reject);
        writeStream.on('error', reject);
        writeStream.on('close', resolve);
        readStream.pipe(writeStream);
      });
    },
  );
  const interval = setInterval(() => {
    const progresses: { key: string; percent: number }[] = [];
    Array.from(keyToProgress.keys()).forEach((key) => {
      const progress = keyToProgress.get(key)!;
      if (progress.writeStream.bytesWritten === progress.size) {
        keyToProgress.delete(key);
      } else {
        progresses.push({
          key,
          percent: progress.writeStream.bytesWritten / progress.size,
        });
      }
    });
    try {
      mainWindow.webContents.send('progress', progresses);
    } catch {
      // just catch, in case of mainWindow destroyed
    }
  }, 1000);
  app.on('before-quit', () => {
    clearInterval(interval);
  });

  ipcMain.removeAllListeners('copyApps');
  ipcMain.handle(
    'copyApps',
    async (event: IpcMainInvokeEvent, sdCard: SdCard) => {
      if (sdCard.forwarderVersion !== forwarderVersion) {
        const appPath = path.join(
          sdCard.key,
          'apps',
          'slippi-nintendont-forwarder',
        );
        await mkdir(appPath, { recursive: true });
        await Promise.all([
          copyFile(
            path.join(forwarderRootPath, 'boot.dol'),
            path.join(appPath, 'boot.dol'),
          ),
          copyFile(
            path.join(forwarderRootPath, 'meta.xml'),
            path.join(appPath, 'meta.xml'),
          ),
        ]);
      }
      if (sdCard.slippiNintendontVersion !== slippiNintendontVersion) {
        const appPath = path.join(sdCard.key, 'apps', 'Slippi Nintendont');
        await mkdir(appPath, { recursive: true });
        await Promise.all([
          copyFile(
            path.join(
              customSlippiNintendontPath || slippiNintendontRootPath,
              'boot.dol',
            ),
            path.join(appPath, 'boot.dol'),
          ),
          copyFile(
            path.join(
              customSlippiNintendontPath || slippiNintendontRootPath,
              'icon.png',
            ),
            path.join(appPath, 'icon.png'),
          ),
          copyFile(
            path.join(
              customSlippiNintendontPath || slippiNintendontRootPath,
              'meta.xml',
            ),
            path.join(appPath, 'meta.xml'),
          ),
        ]);
      }
    },
  );

  ipcMain.removeAllListeners('writeConfig');
  ipcMain.handle(
    'writeConfig',
    async (event: IpcMainInvokeEvent, sdCard: SdCard) => {
      await writeNincfg(sdCard, config, codePath);
    },
  );

  ipcMain.removeAllListeners('ejectSdCard');
  ipcMain.handle('ejectSdCard', (event: IpcMainInvokeEvent, key: string) =>
    eject(key),
  );

  ipcMain.removeAllListeners('getVersion');
  ipcMain.handle('getVersion', app.getVersion);

  ipcMain.removeAllListeners('getVersionLatest');
  ipcMain.handle('getVersionLatest', async () => {
    try {
      const response = await fetch(
        'https://api.github.com/repos/jmlee337/auto-config-for-slippi/releases/latest',
      );
      const json = await response.json();
      const latestVersion = json.tag_name;
      if (typeof latestVersion !== 'string') {
        return '';
      }
      return latestVersion;
    } catch {
      return '';
    }
  });

  ipcMain.removeAllListeners('update');
  ipcMain.on('update', async () => {
    await shell.openExternal(
      'https://github.com/jmlee337/auto-config-for-slippi/releases/latest',
    );
    app.quit();
  });
}
