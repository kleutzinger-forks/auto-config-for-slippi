import { constants } from 'fs';
import {
  access,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'fs/promises';
import path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { list } from 'drivelist';
import { app } from 'electron';
import { gt, valid } from 'semver';
import isValidISO, { isValidGameCubeISO } from './iso';
import { AdditionalIso, Config, SdCard, Video } from '../common/types';

type RemovableDrive = {
  path: string;
  readonly: boolean;
  size: number;
};

const xmlParser = new XMLParser({ parseTagValue: false });

// Additional ISOs are never autobooted, so their on-card folder naming just
// needs to be unique and stable per configured entry, not human-meaningful.
export function additionalIsoRelativePath(id: string) {
  return path.join('games', `extra-${id}`, 'game.iso');
}

// Kept in its own apps/ folder, distinct from Slippi Nintendont, so the two
// builds coexist on the same SD card without either overwriting the other.
export const nintendontRidersDirName = 'Nintendont Riders';

function canEnableStealthAutoboot(slippiNintendontVersion: string) {
  return (
    !valid(slippiNintendontVersion) || gt(slippiNintendontVersion, '1.13.0')
  );
}

async function getSdCard(
  removableDrive: RemovableDrive,
  additionalIsoPaths: AdditionalIso[],
): Promise<SdCard | null> {
  let reason = '';
  let forwarderVersion = '';
  let slippiNintendontVersion = '';
  let nintendontRidersVersion = '';
  let validIsoPath = '';
  const additionalIsoIdsPresent: string[] = [];
  if (!removableDrive.readonly) {
    try {
      await access(removableDrive.path, constants.R_OK | constants.W_OK);

      const slippiNintendontMetaPath = path.join(
        removableDrive.path,
        'apps',
        'Slippi Nintendont',
        'meta.xml',
      );
      try {
        const metaXmlBuffer = await readFile(slippiNintendontMetaPath);
        const metaObj = xmlParser.parse(metaXmlBuffer);
        if (metaObj?.app?.name === 'Slippi Nintendont') {
          const { version } = metaObj.app;
          if (typeof version === 'string') {
            slippiNintendontVersion = version;
          }
        }
      } catch {
        // just catch
      }

      const forwarderMetaPath = path.join(
        removableDrive.path,
        'apps',
        'slippi-nintendont-forwarder',
        'meta.xml',
      );
      try {
        const metaXmlBuffer = await readFile(forwarderMetaPath);
        const metaObj = xmlParser.parse(metaXmlBuffer);
        if (metaObj?.app?.name === 'Forwarder for Slippi Nintendont') {
          const { version } = metaObj.app;
          if (typeof version === 'string') {
            forwarderVersion = version;
          }
        }
      } catch {
        // just catch
      }

      const nintendontRidersMetaPath = path.join(
        removableDrive.path,
        'apps',
        nintendontRidersDirName,
        'meta.xml',
      );
      try {
        const metaXmlBuffer = await readFile(nintendontRidersMetaPath);
        const metaObj = xmlParser.parse(metaXmlBuffer);
        if (metaObj?.app?.name === 'Nintendont - Riders') {
          const { version } = metaObj.app;
          if (typeof version === 'string') {
            nintendontRidersVersion = version;
          }
        }
      } catch {
        // just catch
      }

      const gamesPath = path.join(removableDrive.path, 'games');
      try {
        const gamesPaths = await readdir(gamesPath, { recursive: true });
        const validIsos = (
          await Promise.all(
            gamesPaths
              .filter((gamePath) => gamePath.toLowerCase().endsWith('.iso'))
              // additional ISOs live under games/extra-<id>/ and must never
              // be picked up as the primary autoboot target
              .filter(
                (gamePath) => !gamePath.split(path.sep)[0].startsWith('extra-'),
              )
              .map(async (gamePath) => {
                if (await isValidISO(path.join(gamesPath, gamePath))) {
                  return gamePath;
                }
                return null;
              }),
          )
        ).filter((gamePath) => gamePath !== null) as string[];
        if (validIsos.length > 0) {
          validIsoPath = path.join('games', validIsos[0]);
        }
      } catch {
        // just catch
      }

      await Promise.all(
        additionalIsoPaths.map(async (additionalIso) => {
          if (
            await isValidGameCubeISO(
              path.join(
                removableDrive.path,
                additionalIsoRelativePath(additionalIso.id),
              ),
            )
          ) {
            additionalIsoIdsPresent.push(additionalIso.id);
          }
        }),
      );
    } catch (e: unknown) {
      reason = e instanceof Error ? e.message : JSON.stringify(e ?? 'Unknown');
    }
  } else {
    reason = 'Read Only';
  }

  return {
    key: removableDrive.path,
    reason,
    forwarderVersion,
    slippiNintendontVersion,
    nintendontRidersVersion,
    validIsoPath,
    additionalIsoIdsPresent,
  };
}

export default async function getSdCards(
  additionalIsoPaths: AdditionalIso[],
): Promise<SdCard[]> {
  const removableDriveList: RemovableDrive[] = (await list())
    .filter(
      (drive) =>
        !drive.error &&
        drive.isRemovable &&
        drive.size !== null &&
        !drive.isVirtual &&
        drive.mountpoints.length > 0,
    )
    .map(
      (drive): RemovableDrive => ({
        path:
          process.platform === 'win32'
            ? drive.mountpoints[0].path.slice(0, -1)
            : drive.mountpoints[0].path,
        readonly: drive.isReadOnly,
        size: drive.size!,
      }),
    );

  return (
    await Promise.all(
      removableDriveList.map((removableDrive) =>
        getSdCard(removableDrive, additionalIsoPaths),
      ),
    )
  ).filter((sdCard) => sdCard !== null) as SdCard[];
}

export async function writeNincfg(
  sdCard: SdCard,
  config: Config,
  codePath: string,
) {
  const buffer = Buffer.alloc(324);

  // magic
  buffer.writeUint32BE(0x01070cf6, 0);

  // config version
  buffer.writeUint32BE(0x0000000d, 4);

  // config bits
  let configUint = config.cheats ? 1 : 0;
  if (config.forceProgressive) {
    configUint |= 1 << 5;
  }
  if (config.autoBoot) {
    configUint |= 1 << 10;
  }
  if (config.replays) {
    configUint |= 1 << 14;
  }
  buffer.writeUint32BE(configUint, 8);

  // video mode
  switch (config.video) {
    // high bits
    // 0000: Auto
    // 0001: Force
    // 0002: None
    // 0004: Force DF
    // low bits
    // 0001: PAL50
    // 0002: PAL60
    // 0004: NTSC
    // 0008: MPAL
    case Video.PAL60:
      buffer.writeUint32BE(0x00010002, 12);
      break;
    default:
      // Auto
      buffer.writeUint32BE(0, 12);
      break;
  }

  // language
  buffer.writeUint32BE(0xffffffff, 16);

  // game path
  let gamePath = sdCard.validIsoPath;
  if (process.platform === 'win32') {
    const gamePathParts = gamePath.split(path.sep);
    gamePath = gamePathParts.join('/');
  }
  gamePath = `/${gamePath}`;
  const gamePathLength = gamePath.length;
  if (gamePathLength < 256) {
    const gamePathBuffer = Buffer.from(gamePath);
    gamePathBuffer.copy(buffer, 20);
    for (let i = 20 + gamePathLength; i < 276; i += 1) {
      buffer.writeUint8(0, i);
    }
  }

  // game id
  buffer.writeUint32BE(0x47414c45, 276);

  // mem card blocks
  buffer.writeUint8(2, 280);

  // video scale
  buffer.writeUint8(0, 281);

  // video offset
  buffer.writeUint8(0, 282);

  // unused
  buffer.writeUint8(0, 283);

  // UseUSB
  buffer.writeUInt32BE(0, 284);

  // melee codes
  buffer.writeUInt32BE(config.ucf, 288);
  buffer.writeUInt32BE(config.pal ? 2 : 1, 292);
  buffer.writeUInt32BE(config.mods, 296);
  buffer.writeUInt32BE(config.lag, 300);
  buffer.writeUInt32BE(config.frozen, 304);
  buffer.writeUInt32BE(config.gameplay, 308);
  buffer.writeUInt32BE(config.widescreen, 312);
  buffer.writeUInt32BE(config.safety ? 2 : 1, 316);

  // replay led
  buffer.writeUint32BE(0, 320);

  await writeFile(path.join(sdCard.key, 'slippi_nincfg.bin'), buffer);
  if (config.cheats) {
    // remove any existing codes
    const isoDir = path.dirname(path.join(sdCard.key, sdCard.validIsoPath));
    await rm(path.join(isoDir, 'game.gct'), { force: true });
    await rm(path.join(isoDir, 'GALE01.gct'), { force: true });
    await rm(path.join(sdCard.key, 'games', 'GALE01', 'GALE01.gct'), {
      force: true,
    });

    // copy in our codefile
    await mkdir(path.join(sdCard.key, 'codes'), { recursive: true });
    const dstPath = path.join(sdCard.key, 'codes', 'GALE01.gct');
    if (codePath) {
      await copyFile(codePath, dstPath);
    } else {
      await copyFile(
        app.isPackaged
          ? path.join(process.resourcesPath, 'assets', 'GALE01.gct')
          : path.join(__dirname, '..', '..', 'assets', 'GALE01.gct'),
        dstPath,
      );
    }
  }
  if (canEnableStealthAutoboot(sdCard.slippiNintendontVersion)) {
    if (config.stealthAutoBoot) {
      await writeFile(path.join(sdCard.key, 'enable_stealth_autoboot.txt'), '');
    } else {
      await rm(path.join(sdCard.key, 'enable_stealth_autoboot.txt'), {
        force: true,
      });
    }
  }
}

// Mainline Nintendont's on-disk config struct, unrelated to the Slippi fork's
// slippi_nincfg.bin format above. Reverse engineered from
// common/include/CommonConfig.h (NIN_CFG) in nfsman34/Nintendont-SonicRiders:
// magic/version/config bitmask come first and are stable across the struct's
// internal padding, so those are the only offsets writeNintendontRidersNincfg
// depends on being exactly right.
const NINTENDONT_RIDERS_MAGIC = 0x01070cf6;
const NINTENDONT_RIDERS_CFG_VERSION = 0x0000000a;
const NINTENDONT_RIDERS_CFG_SIZE = 548;
const NINTENDONT_RIDERS_CFG_NATIVE_SI_BIT = 1 << 14;

// Writes/updates the standard nincfg.bin at the SD root (Nintendont Riders,
// unlike Slippi Nintendont, uses this stock filename). Preserves any existing
// config the user has saved via Nintendont's own menu and only forces the
// Native Control bit on.
export async function writeNintendontRidersNincfg(sdCard: SdCard) {
  const nincfgPath = path.join(sdCard.key, 'nincfg.bin');
  let buffer: Buffer | undefined;
  try {
    const existing = await readFile(nincfgPath);
    if (
      existing.length >= NINTENDONT_RIDERS_CFG_SIZE &&
      existing.readUInt32BE(0) === NINTENDONT_RIDERS_MAGIC &&
      existing.readUInt32BE(4) === NINTENDONT_RIDERS_CFG_VERSION
    ) {
      buffer = existing.subarray(0, NINTENDONT_RIDERS_CFG_SIZE);
    }
  } catch {
    // just catch, fall back to a fresh default config below
  }

  if (!buffer) {
    buffer = Buffer.alloc(NINTENDONT_RIDERS_CFG_SIZE);
    buffer.writeUInt32BE(NINTENDONT_RIDERS_MAGIC, 0);
    buffer.writeUInt32BE(NINTENDONT_RIDERS_CFG_VERSION, 4);
    // language: auto
    buffer.writeUInt32BE(0xffffffff, 16);
    // max pads
    buffer.writeUInt32BE(4, 532);
    // mem card blocks
    buffer.writeUInt8(2, 540);
  }

  buffer.writeUInt32BE(
    buffer.readUInt32BE(8) | NINTENDONT_RIDERS_CFG_NATIVE_SI_BIT,
    8,
  );
  await writeFile(nincfgPath, buffer);
}
