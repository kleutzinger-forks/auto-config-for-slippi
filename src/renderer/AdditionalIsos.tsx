import { useEffect, useState } from 'react';
import { IconButton, InputBase, Stack, Tooltip } from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import { AdditionalIso } from '../common/types';

// Additional ISOs aren't necessarily Melee (e.g. a different GameCube game,
// or a modded build) copied alongside the primary ISO so Nintendont can
// list them too. They're intentionally kept out of the autoboot/cheats
// pipeline, which only ever targets the single primary Melee ISO configured
// above.
export default function AdditionalIsos({
  openErrorMessage,
}: {
  openErrorMessage: (message: string) => void;
}) {
  const [additionalIsoPaths, setAdditionalIsoPaths] = useState<AdditionalIso[]>(
    [],
  );

  useEffect(() => {
    (async () => {
      setAdditionalIsoPaths(await window.electron.getAdditionalIsoPaths());
    })();
  }, []);

  return (
    <>
      {additionalIsoPaths.map((additionalIso) => (
        <Stack direction="row" key={additionalIso.id}>
          <InputBase
            disabled
            size="small"
            value={additionalIso.path}
            style={{ flexGrow: 1 }}
          />
          <Tooltip arrow placement="left" title="Remove additional ISO">
            <IconButton
              onClick={async () => {
                setAdditionalIsoPaths(
                  await window.electron.removeAdditionalIsoPath(
                    additionalIso.id,
                  ),
                );
              }}
            >
              <Delete />
            </IconButton>
          </Tooltip>
        </Stack>
      ))}
      <Stack direction="row">
        <InputBase
          disabled
          size="small"
          value="Add additional ISO(s)..."
          style={{ flexGrow: 1 }}
        />
        <Tooltip arrow placement="left" title="Add additional ISO(s)">
          <IconButton
            onClick={async () => {
              try {
                setAdditionalIsoPaths(
                  await window.electron.addAdditionalIsoPaths(),
                );
              } catch (e: unknown) {
                setAdditionalIsoPaths(
                  await window.electron.getAdditionalIsoPaths(),
                );
                openErrorMessage(
                  e instanceof Error ? e.message : JSON.stringify(e ?? ''),
                );
              }
            }}
          >
            <Add />
          </IconButton>
        </Tooltip>
      </Stack>
    </>
  );
}
