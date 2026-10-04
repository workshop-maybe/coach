// The cost order (router R10, R11, KTD12): one card listing the agents cheapest first, each
// with keys to move it up or down. Opened from Home's agent list, or from the router's card,
// which it goes back to. Nothing is written until "Save the order", which places every agent
// listed. Agents the order doesn't name yet come last, as most expensive, marked "Not placed
// yet". The list follows the folder as it reloads: a trashed agent drops out, a new one joins
// at the end.

import { useEffect, useRef, useState } from "react";
import { COST_ORDER_PATH, loadFolder } from "../domain/folder";
import { saveCostOrder } from "../domain/operations";
import { byCost, costPlaces } from "../domain/recommend";
import type { FolderState, Slug } from "../domain/types";
import { Machine } from "../cast/Machine";
import { Deck } from "./Deck";
import { setupText } from "./format";
import { useNav } from "./nav";
import type { RouterResume } from "./routes";
import { useFolder } from "./useFolderState";

export function CostOrderDeck({ returnTo }: { returnTo?: RouterResume }) {
  const { state } = useFolder();
  if (!state) return null;
  return <CostOrder atOpen={state} returnTo={returnTo} />;
}

type Dir = "up" | "down";

function CostOrder({ atOpen, returnTo }: { atOpen: FolderState; returnTo?: RouterResume }) {
  const { storage, state, apply, reload } = useFolder();
  const { navigate } = useNav();
  const [opened] = useState(() => ({ order: byCost(atOpen).map((p) => p.slug), base: atOpen.raw[COST_ORDER_PATH] ?? null }));
  const [order, setOrder] = useState<Slug[]>(opened.order);
  const [said, setSaid] = useState("");
  const [focusAfter, setFocusAfter] = useState<{ slug: Slug; dir: Dir } | null>(null);
  const keys = useRef(new Map<string, HTMLButtonElement>());

  const current = state ?? atOpen;
  const bySlug = new Map(current.profiles.map((p) => [p.slug, p]));
  // The order as moved, kept to agents still in the folder, then any agent added since, last.
  const shown = [...order.filter((s) => bySlug.has(s)), ...current.profiles.map((p) => p.slug).filter((s) => !order.includes(s))];
  const placed = costPlaces(current);

  const leave = () => navigate(returnTo ? { view: "deck", deck: "router", resume: returnTo } : { view: "home" });

  // Focus stays with the agent that moved: on the key pressed, or on its other key once the
  // pressed one is disabled at an end of the list.
  useEffect(() => {
    if (!focusAfter) return;
    const { slug, dir } = focusAfter;
    const pressed = keys.current.get(`${slug}:${dir}`);
    const other = keys.current.get(`${slug}:${dir === "up" ? "down" : "up"}`);
    (pressed && !pressed.disabled ? pressed : other)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  function move(slug: Slug, dir: Dir) {
    const from = shown.indexOf(slug);
    const to = dir === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= shown.length) return;
    const next = [...shown];
    [next[from], next[to]] = [next[to], next[from]];
    setOrder(next);
    setSaid(`${bySlug.get(slug)?.name ?? slug}, ${to + 1} of ${next.length}`);
    setFocusAfter({ slug, dir });
  }

  async function finish({ keepMine }: { keepMine: boolean }) {
    const folder = keepMine ? await loadFolder(storage) : current;
    const base = keepMine ? (folder.raw[COST_ORDER_PATH] ?? null) : opened.base;
    apply(await saveCostOrder(storage, folder, shown, base));
    leave();
  }

  async function useTheirs() {
    await reload();
    leave();
  }

  const body = (
    <>
      <ol className="cost-order" aria-label="Agents, cheapest first">
        {shown.map((slug, i) => {
          const p = bySlug.get(slug)!;
          return (
            <li key={slug} className="cost-order-row">
              <span className="cost-order-place" aria-hidden="true">
                {i + 1}
              </span>
              <Machine mini setup={p} width={48} />
              <span className="cost-order-agent">
                <span className="cost-order-name">{p.name}</span>
                <span className="cost-order-setup">{setupText(p)}</span>
                {!placed.has(slug) && <span className="cost-order-new">Not placed yet</span>}
              </span>
              <span className="cost-order-keys">
                <button
                  type="button"
                  ref={(el) => void (el ? keys.current.set(`${slug}:up`, el) : keys.current.delete(`${slug}:up`))}
                  aria-label={`Move ${p.name} up`}
                  disabled={i === 0}
                  onClick={() => move(slug, "up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  ref={(el) => void (el ? keys.current.set(`${slug}:down`, el) : keys.current.delete(`${slug}:down`))}
                  aria-label={`Move ${p.name} down`}
                  disabled={i === shown.length - 1}
                  onClick={() => move(slug, "down")}
                >
                  ↓
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
    </>
  );

  return (
    <Deck
      label="Order by cost"
      beats={[{ id: "order", title: "Cheapest first", forward: "Save the order", valid: shown.length > 0, body }]}
      onClose={leave}
      onFinish={finish}
      onUseTheirs={() => void useTheirs()}
    />
  );
}
