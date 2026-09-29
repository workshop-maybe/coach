// An agent's own machine, with its earned keys to handle (R8). The drawing stays
// decorative; a real button sits over each lit key, named for its credential on hover
// and focus. A half-raised key starts its re-test, a lit one opens its badge. Keys page
// in sixteens, with a page control under the machine when there is more than one page.

import { useState } from "react";
import type { AgentSetup } from "../domain/types";
import { Machine, keyBox } from "../cast/Machine";
import { trigPages, type EncoderDial, type MachineKey } from "../cast/mappings";

export interface KeyedMachineProps {
  setup: AgentSetup;
  keys: readonly MachineKey[];
  onKey(key: MachineKey): void;
  onStep?(dial: EncoderDial, by: 1 | -1): void;
  width?: number;
}

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;

/** What a key says on hover and focus: its credential, and when it needs a re-test. */
export function keyLabel(key: MachineKey): string {
  return key.halfRaised ? `${key.name}, re-test` : key.name;
}

export function KeyedMachine({ setup, keys, onKey, onStep, width = 300 }: KeyedMachineProps) {
  const pages = trigPages(keys);
  const [page, setPage] = useState(0);
  const [named, setNamed] = useState<MachineKey | null>(null);
  const at = Math.min(page, pages.length - 1);

  return (
    <div className="keyed-machine">
      <div className="keyed-machine-frame">
        <Machine setup={setup} keys={keys} page={at} onStep={onStep} width={width} />
        <ul className="machine-keys" aria-label="Earned">
          {pages[at].map((key, i) => {
            const box = keyBox(i);
            const label = keyLabel(key);
            return (
              <li key={key.id}>
                <button
                  type="button"
                  className="machine-key"
                  data-key={key.halfRaised ? "raised" : "lit"}
                  aria-label={label}
                  title={label}
                  style={{ left: pct(box.left), top: pct(box.top), width: pct(box.width), height: pct(box.height) }}
                  onFocus={() => setNamed(key)}
                  onBlur={() => setNamed(null)}
                  onMouseEnter={() => setNamed(key)}
                  onMouseLeave={() => setNamed(null)}
                  onClick={() => onKey(key)}
                />
              </li>
            );
          })}
        </ul>
      </div>
      <div className="machine-under">
        <p className="machine-key-name" aria-hidden="true">
          {named ? keyLabel(named) : ""}
        </p>
        {pages.length > 1 && (
          <div className="machine-pages" role="group" aria-label="Pages">
            <button type="button" className="ghost" aria-label="Previous page" disabled={at === 0} onClick={() => setPage(at - 1)}>
              ‹
            </button>
            <span className="machine-page" aria-live="polite">
              {at + 1} / {pages.length}
            </span>
            <button type="button" className="ghost" aria-label="Next page" disabled={at === pages.length - 1} onClick={() => setPage(at + 1)}>
              ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
