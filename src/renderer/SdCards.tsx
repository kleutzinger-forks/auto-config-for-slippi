import {
  Alert,
  Button,
  IconButton,
  InputBase,
  LinearProgress,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { Eject, Refresh } from '@mui/icons-material';
import { AdditionalIso, SdCard } from '../common/types';

function SdCardContent({
  keyToPercent,
  sdCard,
  additionalIsoPaths,
  forwarderVersion,
  slippiNintendontVersion,
  nintendontRidersEnabled,
  nintendontRidersVersion,
  openErrorMessage,
  refresh,
}: {
  keyToPercent: Map<string, number>;
  sdCard: SdCard;
  additionalIsoPaths: AdditionalIso[];
  forwarderVersion: string;
  slippiNintendontVersion: string;
  nintendontRidersEnabled: boolean;
  nintendontRidersVersion: string;
  openErrorMessage: (message: string) => void;
  refresh: () => Promise<void>;
}) {
  const [copyingIso, setCopyingIso] = useState(false);
  const [copyingAdditionalIsoIds, setCopyingAdditionalIsoIds] = useState(
    new Set<string>(),
  );
  const [copyingApps, setCopyingApps] = useState(false);
  const [writing, setWriting] = useState(false);
  const [wrote, setWrote] = useState(false);

  return sdCard.reason ? (
    <Alert severity="warning">{sdCard.reason}</Alert>
  ) : (
    <>
      <Typography variant="caption" lineHeight="20px">
        {sdCard.validIsoPath ? '✅' : '❌'} Melee ISO
        {sdCard.validIsoPath ? `: ${sdCard.validIsoPath}` : ' not found'}
      </Typography>
      {additionalIsoPaths.map((additionalIso) => {
        const present = sdCard.additionalIsoIdsPresent.includes(
          additionalIso.id,
        );
        const copying = copyingAdditionalIsoIds.has(additionalIso.id);
        return (
          <Stack
            key={additionalIso.id}
            direction="row"
            alignItems="center"
            gap="8px"
          >
            <Typography variant="caption" lineHeight="20px" flexGrow={1}>
              {present ? '✅' : '❌'} {additionalIso.path}
            </Typography>
            {copying && (
              <LinearProgress
                variant="determinate"
                value={
                  (keyToPercent.get(`${sdCard.key}#${additionalIso.id}`) ?? 0) *
                  100
                }
                style={{ flexGrow: 1 }}
              />
            )}
            <Button
              disabled={present || copying}
              size="small"
              variant="contained"
              onClick={async () => {
                setCopyingAdditionalIsoIds((prev) =>
                  new Set(prev).add(additionalIso.id),
                );
                try {
                  await window.electron.copyAdditionalIso(
                    sdCard,
                    additionalIso.id,
                  );
                  await refresh();
                } catch (e: unknown) {
                  openErrorMessage(
                    e instanceof Error ? e.message : JSON.stringify(e ?? ''),
                  );
                } finally {
                  setCopyingAdditionalIsoIds((prev) => {
                    const next = new Set(prev);
                    next.delete(additionalIso.id);
                    return next;
                  });
                }
              }}
            >
              {copying ? 'Copying...' : 'Copy'}
            </Button>
          </Stack>
        );
      })}
      <Typography variant="caption" lineHeight="20px">
        {sdCard.forwarderVersion === forwarderVersion ? '✅' : '❌'} Forwarder
        for Slippi Nintendont{' '}
        {sdCard.forwarderVersion
          ? `version: ${sdCard.forwarderVersion}`
          : 'not found'}
      </Typography>
      <Typography variant="caption" lineHeight="20px">
        {sdCard.slippiNintendontVersion === slippiNintendontVersion
          ? '✅'
          : '❌'}{' '}
        Slippi Nintendont{' '}
        {sdCard.slippiNintendontVersion
          ? `version: ${sdCard.slippiNintendontVersion}`
          : 'not found'}
      </Typography>
      {nintendontRidersEnabled && (
        <Typography variant="caption" lineHeight="20px">
          {sdCard.nintendontRidersVersion === nintendontRidersVersion
            ? '✅'
            : '❌'}{' '}
          Nintendont Riders{' '}
          {sdCard.nintendontRidersVersion
            ? `version: ${sdCard.nintendontRidersVersion}`
            : 'not found'}
        </Typography>
      )}
      {copyingIso && (
        <LinearProgress
          variant="determinate"
          value={(keyToPercent.get(sdCard.key) ?? 0) * 100}
        />
      )}
      <Stack direction="row" justifyContent="end" gap="8px" marginTop="8px">
        <Button
          disabled={Boolean(sdCard.validIsoPath) || copyingIso}
          variant="contained"
          onClick={async () => {
            setCopyingIso(true);
            try {
              await window.electron.copyIso(sdCard);
              refresh();
            } catch (e: unknown) {
              openErrorMessage(
                e instanceof Error ? e.message : JSON.stringify(e ?? ''),
              );
            } finally {
              setCopyingIso(false);
            }
          }}
        >
          {copyingIso ? 'Copying ISO...' : 'Copy ISO'}
        </Button>
        <Button
          disabled={
            (sdCard.forwarderVersion === forwarderVersion &&
              sdCard.slippiNintendontVersion === slippiNintendontVersion &&
              (!nintendontRidersEnabled ||
                sdCard.nintendontRidersVersion === nintendontRidersVersion)) ||
            copyingApps
          }
          variant="contained"
          onClick={async () => {
            setCopyingApps(true);
            try {
              await window.electron.copyApps(sdCard);
              refresh();
            } catch (e: unknown) {
              openErrorMessage(
                e instanceof Error ? e.message : JSON.stringify(e ?? ''),
              );
            } finally {
              setCopyingApps(false);
            }
          }}
        >
          Copy Apps
        </Button>
        <Button
          disabled={
            !sdCard.validIsoPath ||
            sdCard.slippiNintendontVersion !== slippiNintendontVersion ||
            (nintendontRidersEnabled &&
              sdCard.nintendontRidersVersion !== nintendontRidersVersion) ||
            writing ||
            wrote
          }
          variant="contained"
          onClick={async () => {
            setWriting(true);
            try {
              await window.electron.writeConfig(sdCard);
              setWrote(true);
              setTimeout(() => {
                setWrote(false);
              }, 5000);
            } catch (e: unknown) {
              openErrorMessage(
                e instanceof Error ? e.message : JSON.stringify(e ?? ''),
              );
            } finally {
              setWriting(false);
            }
          }}
        >
          {wrote ? 'Copied!' : 'Copy Config'}
        </Button>
      </Stack>
    </>
  );
}

function SdCardEl({
  keyToPercent,
  sdCard,
  additionalIsoPaths,
  forwarderVersion,
  slippiNintendontVersion,
  nintendontRidersEnabled,
  nintendontRidersVersion,
  openErrorMessage,
  refresh,
  removeSdCard,
}: {
  keyToPercent: Map<string, number>;
  sdCard: SdCard;
  additionalIsoPaths: AdditionalIso[];
  forwarderVersion: string;
  slippiNintendontVersion: string;
  nintendontRidersEnabled: boolean;
  nintendontRidersVersion: string;
  openErrorMessage: (message: string) => void;
  refresh: () => Promise<void>;
  removeSdCard: () => void;
}) {
  const [ejecting, setEjecting] = useState(false);

  return (
    <Paper
      elevation={2}
      style={{ display: 'flex', flexDirection: 'column', padding: '0 8px 8px' }}
    >
      <Stack direction="row">
        <InputBase
          disabled
          size="small"
          value={sdCard.key}
          style={{ flexGrow: 1 }}
        />
        <Tooltip arrow placement="left" title="Eject">
          <IconButton
            disabled={ejecting}
            onClick={async () => {
              setEjecting(true);
              try {
                await window.electron.ejectSdCard(sdCard.key);
                removeSdCard();
              } catch (e: unknown) {
                openErrorMessage(
                  e instanceof Error ? e.message : JSON.stringify(e ?? ''),
                );
              } finally {
                setEjecting(false);
              }
            }}
          >
            <Eject />
          </IconButton>
        </Tooltip>
      </Stack>
      <SdCardContent
        keyToPercent={keyToPercent}
        sdCard={sdCard}
        additionalIsoPaths={additionalIsoPaths}
        forwarderVersion={forwarderVersion}
        slippiNintendontVersion={slippiNintendontVersion}
        nintendontRidersEnabled={nintendontRidersEnabled}
        nintendontRidersVersion={nintendontRidersVersion}
        openErrorMessage={openErrorMessage}
        refresh={refresh}
      />
    </Paper>
  );
}

export default function SdCards({
  slippiNintendontVersion,
  openErrorMessage,
}: {
  slippiNintendontVersion: string;
  openErrorMessage: (message: string) => void;
}) {
  const [sdCards, setSdCards] = useState<SdCard[]>([]);
  const [forwarderVersion, setForwarderVersion] = useState('');
  const [nintendontRidersEnabled, setNintendontRidersEnabled] = useState(false);
  const [nintendontRidersVersion, setNintendontRidersVersion] = useState('');
  const [additionalIsoPaths, setAdditionalIsoPaths] = useState<AdditionalIso[]>(
    [],
  );
  useEffect(() => {
    (async () => {
      const sdCardsPromise = window.electron.getSdCards();
      const forwarderVersionPromise = window.electron.getForwarderVersion();
      const configPromise = window.electron.getConfig();
      const nintendontRidersVersionPromise =
        window.electron.getNintendontRidersVersion();
      const additionalIsoPathsPromise = window.electron.getAdditionalIsoPaths();
      setSdCards(await sdCardsPromise);
      setForwarderVersion(await forwarderVersionPromise);
      setNintendontRidersEnabled((await configPromise).nintendontRiders);
      setNintendontRidersVersion(await nintendontRidersVersionPromise);
      setAdditionalIsoPaths(await additionalIsoPathsPromise);
    })();
  }, []);

  const [keyToPercent, setKeyToPercent] = useState(new Map<string, number>());
  useEffect(() => {
    window.electron.onProgress((event, progress) => {
      setKeyToPercent(
        new Map(progress.map(({ key, percent }) => [key, percent])),
      );
    });
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const sdCardsPromise = window.electron.getSdCards();
      setAdditionalIsoPaths(await window.electron.getAdditionalIsoPaths());
      setNintendontRidersEnabled(
        (await window.electron.getConfig()).nintendontRiders,
      );
      setSdCards(await sdCardsPromise);
    } catch (e: unknown) {
      openErrorMessage(
        e instanceof Error ? e.message : JSON.stringify(e ?? ''),
      );
    } finally {
      setRefreshing(false);
    }
  }, [openErrorMessage]);

  const [ejecting, setEjecting] = useState(false);

  return (
    <Stack margin="8px -8px" gap="8px">
      <Paper
        elevation={2}
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '0 8px 8px',
        }}
      >
        <Stack direction="row">
          <InputBase
            disabled
            size="small"
            value={sdCards.length > 0 ? sdCards[0].key : 'Insert SD Card...'}
            style={{ flexGrow: 1 }}
          />
          {sdCards.length > 0 && (
            <Tooltip arrow placement="left" title="Eject">
              <IconButton
                disabled={ejecting}
                onClick={async () => {
                  setEjecting(true);
                  try {
                    await window.electron.ejectSdCard(sdCards[0].key);
                    const newSdCards = sdCards.slice(1);
                    setSdCards(newSdCards);
                  } catch (e: unknown) {
                    openErrorMessage(
                      e instanceof Error ? e.message : JSON.stringify(e ?? ''),
                    );
                  } finally {
                    setEjecting(false);
                  }
                }}
              >
                <Eject />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip arrow placement="top" title="Refresh">
            <IconButton disabled={refreshing} onClick={refresh}>
              <Refresh />
            </IconButton>
          </Tooltip>
        </Stack>
        {sdCards.length > 0 && (
          <SdCardContent
            keyToPercent={keyToPercent}
            sdCard={sdCards[0]}
            additionalIsoPaths={additionalIsoPaths}
            forwarderVersion={forwarderVersion}
            slippiNintendontVersion={slippiNintendontVersion}
            nintendontRidersEnabled={nintendontRidersEnabled}
            nintendontRidersVersion={nintendontRidersVersion}
            openErrorMessage={openErrorMessage}
            refresh={refresh}
          />
        )}
      </Paper>
      {sdCards.slice(1).map((sdCard) => (
        <SdCardEl
          key={sdCard.key}
          keyToPercent={keyToPercent}
          sdCard={sdCard}
          additionalIsoPaths={additionalIsoPaths}
          forwarderVersion={forwarderVersion}
          slippiNintendontVersion={slippiNintendontVersion}
          nintendontRidersEnabled={nintendontRidersEnabled}
          nintendontRidersVersion={nintendontRidersVersion}
          openErrorMessage={openErrorMessage}
          refresh={refresh}
          removeSdCard={() => {
            const newSdCards = sdCards.filter(
              (newSdCard) => newSdCard.key !== sdCard.key,
            );
            setSdCards(newSdCards);
          }}
        />
      ))}
    </Stack>
  );
}
