"use client";

import { useCallback, useRef } from "react";

import type { CabinView, SeatView } from "@/lib/flight-view";
import { resolveSeatState, type SeatState } from "@/lib/seat-state";
import { CheckIcon, ClockIcon, CrossIcon } from "./icons";

/**
 * The cabin, drawn as an aircraft.
 *
 * Seats are laid out from `aircraft_layouts.seat_configuration`, never from a
 * fixed grid, so the arrangement is whatever the real aircraft has: the A320neo
 * seeds as 2-2 Business over 3-3 Economy, the widebodies as 1-2-1 over 3-3-3.
 * A missing seat leaves a hole in the fuselage rather than shifting its
 * neighbours left.
 *
 * The fuselage itself — nose cone, cockpit glazing, cabin walls, tail taper —
 * is structural, not decoration: it tells you at a glance which end is the
 * front, which seats are against a window, and where one cabin ends.
 *
 * Accessibility notes that are easy to regress:
 *  - Unavailable seats use `aria-disabled`, not `disabled`, so they stay in the
 *    tab order and can be read. A screen reader user needs to *find* a taken
 *    seat to understand the map; silently removing it is worse than useless.
 *  - Roving tabindex: the grid is one tab stop, arrows move within it. Tabbing
 *    through 180 buttons to reach the form would be indefensible.
 *  - State is never carried by colour alone — every seat has a glyph and a
 *    written state in its accessible name.
 */

/** Apple HIG / Material minimum touch target, held even in the compact cabin. */
const ECONOMY_SEAT = 44;
/** Business seats are physically bigger; the map says so. */
const BUSINESS_SEAT_W = 58;
const BUSINESS_SEAT_H = 50;

const GAP = 6;
const AISLE = 30;
const GUTTER = 26;
/** Rows between repeats of the column-letter header. */
const HEADER_EVERY = 12;

type SeatMapProps = {
  cabins: CabinView[];
  /** Live availability. Changing these re-paints seats and nothing else. */
  booked: ReadonlySet<string>;
  held: ReadonlySet<string>;
  /** seatId -> 1-based passenger number, for the badge on a chosen seat. */
  assignments: ReadonlyMap<string, number>;
  pendingSeatId: string | null;
  disabled: boolean;
  onSelect: (seat: SeatView) => void;
};

export function SeatMap({
  cabins,
  booked,
  held,
  assignments,
  pendingSeatId,
  disabled,
  onSelect,
}: SeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const focusSeat = useCallback((seatId: string) => {
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`[data-seat-id="${seatId}"]`)
      ?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, cabinIndex: number, rowIndex: number, colIndex: number) => {
      const next = navigate(cabins, cabinIndex, rowIndex, colIndex, event.key);
      if (!next) return;
      event.preventDefault();
      focusSeat(next.id);
    },
    [cabins, focusSeat],
  );

  const mine = new Set(assignments.keys());
  const allSeats = cabins.flatMap((c) => c.rows.flatMap((r) => r.seats));

  // The grid is a single tab stop; arrows move inside it.
  const rovingSeatId =
    allSeats.find((s): s is SeatView => s !== null && mine.has(s.id))?.id ??
    allSeats.find(
      (s): s is SeatView =>
        s !== null && resolveSeatState(s.id, booked, held, null) === "available",
    )?.id ??
    allSeats.find((s) => s !== null)?.id ??
    null;

  const widest = Math.max(...cabins.map((cabin) => cabinWidth(cabin)));

  return (
    <div className="overflow-x-auto pb-2">
      <div ref={containerRef} className="mx-auto w-max px-1">
        <Fuselage width={widest}>
          {cabins.map((cabin, cabinIndex) => (
            <section
              key={`${cabin.class}-${cabinIndex}`}
              aria-label={`${cabin.class} cabin`}
              className={cabinIndex > 0 ? "mt-2 border-t border-hairline pt-5" : ""}
            >
              <header className="mb-3 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
                <h3 className="font-display text-[1.25rem] leading-none tracking-[-0.012em] text-bone">
                  {cabin.class}
                </h3>
                <span className="eyebrow">
                  rows {cabin.rows[0]?.row}–{cabin.rows[cabin.rows.length - 1]?.row} ·{" "}
                  {cabin.columns.length} across · {cabin.baggageAllowanceKg}kg included
                </span>
              </header>

              <div
                className="mx-auto grid items-center"
                style={{
                  gridTemplateColumns: templateColumns(cabin),
                  rowGap: `${GAP}px`,
                  columnGap: 0,
                  width: cabinWidth(cabin),
                }}
              >
                {cabin.rows.flatMap((cabinRow, rowIndex) => {
                  // Column letters repeat down a long cabin. `position: sticky`
                  // is unavailable here — the horizontal scroll container makes
                  // both axes non-visible, which kills it — and a 29-row cabin
                  // whose letters exist only at the top is unreadable by row 40.
                  const header =
                    rowIndex % HEADER_EVERY === 0
                      ? [
                          <div key={`hs-${rowIndex}`} />,
                          ...renderHeaderCells(cabin, rowIndex),
                          <div key={`he-${rowIndex}`} />,
                        ]
                      : [];

                  return [
                    ...header,
                    <RowCells
                      key={cabinRow.row}
                      cabin={cabin}
                      cabinIndex={cabinIndex}
                      rowIndex={rowIndex}
                      booked={booked}
                      held={held}
                      assignments={assignments}
                      pendingSeatId={pendingSeatId}
                      rovingSeatId={rovingSeatId}
                      disabled={disabled}
                      onSelect={onSelect}
                      onKeyDown={handleKeyDown}
                    />,
                  ];
                })}
              </div>
            </section>
          ))}
        </Fuselage>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Fuselage                                  */
/* -------------------------------------------------------------------------- */

/**
 * Nose, cabin walls and tail.
 *
 * Purely presentational and hidden from assistive tech — the cabin sections
 * inside carry all the meaning. The nose is an ellipse clipped to its top half
 * so the taper reads as an aircraft rather than a rounded rectangle.
 */
function Fuselage({ width, children }: { width: number; children: React.ReactNode }) {
  const shell = width + 56;
  const noseHeight = 84;
  const tailHeight = 58;

  // One path each for nose and tail rather than stacked rounded boxes: two
  // boxes leave a visible seam where their borders meet, and the taper has to
  // be continuous for the shape to read as a fuselage.
  const nose = `M 0 ${noseHeight} C 0 ${noseHeight * 0.34} ${shell * 0.3} 0 ${shell / 2} 0 C ${shell * 0.7} 0 ${shell} ${noseHeight * 0.34} ${shell} ${noseHeight}`;
  const tail = `M 0 0 C 0 ${tailHeight * 0.62} ${shell * 0.32} ${tailHeight} ${shell / 2} ${tailHeight} C ${shell * 0.68} ${tailHeight} ${shell} ${tailHeight * 0.62} ${shell} 0`;

  return (
    <div className="flex flex-col items-center" style={{ width: shell }}>
      <div className="relative" style={{ width: shell, height: noseHeight }} aria-hidden="true">
        <svg
          width={shell}
          height={noseHeight}
          viewBox={`0 0 ${shell} ${noseHeight}`}
          className="block"
        >
          <path d={nose} fill="var(--color-stage-lift)" stroke="var(--color-hairline)" strokeWidth="1" />
        </svg>

        {/* Cockpit glazing, sitting where the flight deck actually is */}
        <div className="absolute inset-x-0 bottom-[14px] flex items-end justify-center gap-[4px]">
          <span className="h-[11px] w-[14px] -skew-x-[24deg] rounded-[2px] bg-[rgba(236,230,220,0.14)]" />
          <span className="h-[14px] w-[21px] rounded-[3px] bg-[rgba(236,230,220,0.26)]" />
          <span className="h-[14px] w-[21px] rounded-[3px] bg-[rgba(236,230,220,0.26)]" />
          <span className="h-[11px] w-[14px] skew-x-[24deg] rounded-[2px] bg-[rgba(236,230,220,0.14)]" />
        </div>

        <span className="eyebrow absolute inset-x-0 top-[26px] text-center">Front</span>
      </div>

      {/* Cabin — the walls are the left and right borders. Pulled up a pixel so
          the nose path and the wall share an edge instead of stacking. */}
      <div
        className="border-x border-hairline bg-stage-lift px-4 py-5 shadow-card"
        style={{ width: shell, marginTop: -1 }}
      >
        {children}
      </div>

      <div className="relative" style={{ width: shell, height: tailHeight, marginTop: -1 }} aria-hidden="true">
        <svg width={shell} height={tailHeight} viewBox={`0 0 ${shell} ${tailHeight}`} className="block">
          <path d={tail} fill="var(--color-stage-lift)" stroke="var(--color-hairline)" strokeWidth="1" />
        </svg>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Layout                                   */
/* -------------------------------------------------------------------------- */

const seatWidth = (cabin: CabinView) =>
  cabin.class === "Business" ? BUSINESS_SEAT_W : ECONOMY_SEAT;
const seatHeight = (cabin: CabinView) =>
  cabin.class === "Business" ? BUSINESS_SEAT_H : ECONOMY_SEAT;

function templateColumns(cabin: CabinView): string {
  const parts: string[] = [`${GUTTER}px`];
  cabin.columns.forEach((column, index) => {
    // The column carries the gap: padding the cell instead would let flex
    // shrink the button below the minimum touch target.
    parts.push(`${seatWidth(cabin) + GAP}px`);
    if (cabin.aislesAfter.includes(column) && index < cabin.columns.length - 1) {
      parts.push(`${AISLE}px`);
    }
  });
  parts.push(`${GUTTER}px`);
  return parts.join(" ");
}

function cabinWidth(cabin: CabinView): number {
  const aisles = cabin.aislesAfter.filter(
    (c) => cabin.columns.indexOf(c) < cabin.columns.length - 1,
  ).length;
  return GUTTER * 2 + cabin.columns.length * (seatWidth(cabin) + GAP) + aisles * AISLE;
}

/** Column letters, with the window rail marked at each end of the cabin. */
function renderHeaderCells(cabin: CabinView, band: number) {
  const cells: React.ReactNode[] = [];

  cabin.columns.forEach((column, index) => {
    const isEdge = index === 0 || index === cabin.columns.length - 1;
    cells.push(
      <div key={`h-${band}-${column}`} className="pt-1 pb-2 text-center">
        <span className="eyebrow block text-bone">{column}</span>
        {isEdge ? (
          <span className="mt-[3px] block text-[8px] uppercase tracking-[0.08em] text-bone-50/70">
            win
          </span>
        ) : null}
      </div>,
    );

    if (cabin.aislesAfter.includes(column) && index < cabin.columns.length - 1) {
      cells.push(<div key={`h-${band}-a-${column}`} aria-hidden="true" />);
    }
  });

  return cells;
}

type RowCellsProps = {
  cabin: CabinView;
  cabinIndex: number;
  rowIndex: number;
  booked: ReadonlySet<string>;
  held: ReadonlySet<string>;
  assignments: ReadonlyMap<string, number>;
  pendingSeatId: string | null;
  rovingSeatId: string | null;
  disabled: boolean;
  onSelect: (seat: SeatView) => void;
  onKeyDown: (e: React.KeyboardEvent, c: number, r: number, col: number) => void;
};

function RowCells({
  cabin,
  cabinIndex,
  rowIndex,
  booked,
  held,
  assignments,
  pendingSeatId,
  rovingSeatId,
  disabled,
  onSelect,
  onKeyDown,
}: RowCellsProps) {
  const cabinRow = cabin.rows[rowIndex];
  const cells: React.ReactNode[] = [];

  cells.push(
    <div key="gs" className="numeric pr-2 text-right text-[11px] text-bone-50">
      {cabinRow.row}
    </div>,
  );

  cabin.columns.forEach((column, colIndex) => {
    const seat = cabinRow.seats[colIndex];
    cells.push(
      <div key={`${cabinRow.row}-${column}`} className="flex justify-center">
        {seat ? (
          <Seat
            seat={seat}
            cabinClass={cabin.class}
            state={resolveSeatState(
              seat.id,
              booked,
              held,
              assignments.has(seat.id) ? seat.id : null,
            )}
            passengerNumber={assignments.get(seat.id) ?? null}
            isPending={seat.id === pendingSeatId}
            isRovingStop={seat.id === rovingSeatId}
            disabled={disabled}
            onSelect={onSelect}
            onKeyDown={(e) => onKeyDown(e, cabinIndex, rowIndex, colIndex)}
          />
        ) : (
          <div
            style={{ width: seatWidth(cabin), height: seatHeight(cabin) }}
            aria-hidden="true"
          />
        )}
      </div>,
    );

    if (cabin.aislesAfter.includes(column) && colIndex < cabin.columns.length - 1) {
      cells.push(
        // A dashed centre line down the gap: the aisle reads as a walkway
        // rather than as a rendering mistake.
        <div key={`${cabinRow.row}-a-${column}`} aria-hidden="true" className="flex h-full justify-center">
          <span className="h-full w-px bg-hairline" />
        </div>,
      );
    }
  });

  cells.push(
    <div key="ge" className="numeric pl-2 text-[11px] text-bone-50">
      {cabinRow.row}
    </div>,
  );

  return <>{cells}</>;
}

/* -------------------------------------------------------------------------- */
/*                                    Seat                                    */
/* -------------------------------------------------------------------------- */

const STATE_LABEL: Record<SeatState, string> = {
  available: "available",
  held: "on hold by another traveller",
  booked: "already booked",
  selected: "chosen",
};

/**
 * One seat.
 *
 * Every state carries three signals: a fill, a glyph, and words in the
 * accessible name. Colour alone would fail anyone with a colour vision
 * deficiency, and a seat map is exactly the kind of dense grid where that
 * matters most.
 */
function Seat({
  seat,
  cabinClass,
  state,
  passengerNumber,
  isPending,
  isRovingStop,
  disabled,
  onSelect,
  onKeyDown,
}: {
  seat: SeatView;
  cabinClass: "Economy" | "Business";
  state: SeatState;
  passengerNumber: number | null;
  isPending: boolean;
  isRovingStop: boolean;
  disabled: boolean;
  onSelect: (seat: SeatView) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  const selectable = state === "available" || state === "selected";
  const isBusiness = cabinClass === "Business";

  const position = seat.isWindow ? "window" : seat.isAisle ? "aisle" : "middle";
  const label =
    `Seat ${seat.seatNumber}, ${seat.class}, ${position} seat, ${STATE_LABEL[state]}` +
    (passengerNumber ? ` by passenger ${passengerNumber}` : "");

  return (
    <button
      type="button"
      data-seat-id={seat.id}
      data-state={state}
      data-cabin={cabinClass}
      aria-label={label}
      aria-pressed={state === "selected"}
      aria-disabled={!selectable || disabled}
      tabIndex={isRovingStop ? 0 : -1}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (!selectable || disabled || isPending) return;
        onSelect(seat);
      }}
      style={{
        width: isBusiness ? BUSINESS_SEAT_W : ECONOMY_SEAT,
        height: isBusiness ? BUSINESS_SEAT_H : ECONOMY_SEAT,
      }}
      className={[
        "relative flex shrink-0 flex-col items-center justify-center gap-[1px]",
        isBusiness ? "rounded-lg border-2" : "rounded-md border",
        "transition-[background-color,border-color,transform,opacity] duration-200 ease-[var(--ease-standard)]",
        seatClasses(state, selectable && !disabled, isBusiness),
        isPending ? "animate-pulse" : "",
      ].join(" ")}
    >
      {/* Headrest. Business seats get a wider one in amber — the visual cue
          that this is the premium cabin, without a second accent colour. */}
      <span
        aria-hidden="true"
        className={[
          "absolute top-[3px] rounded-pill",
          isBusiness ? "h-[3px] w-[24px]" : "h-[2px] w-[14px]",
          headrestClasses(state, isBusiness),
        ].join(" ")}
      />

      {state === "selected" && passengerNumber ? (
        <span className="numeric text-[11px] font-semibold leading-none">
          {passengerNumber}
        </span>
      ) : state === "selected" ? (
        <CheckIcon size={13} />
      ) : state === "booked" ? (
        <CrossIcon size={13} className="text-bone-50/60" />
      ) : state === "held" ? (
        <ClockIcon size={13} className="text-bone-50" />
      ) : null}

      <span className={`numeric leading-none ${isBusiness ? "text-[11px]" : "text-[10.5px]"}`}>
        {seat.seatNumber}
      </span>
    </button>
  );
}

/**
 * Three unavailable-looking states have to be told apart at a glance, so each
 * gets its own signal rather than a shade of the same one:
 *
 *   available — the lightest fill; the only one that looks raised
 *   held      — mid fill plus a diagonal hatch; texture reads as "in flux"
 *   booked    — recessed *below* the cabin floor, flat, no texture
 *
 * Luminance, texture and glyph all differ, which keeps the map legible in
 * greyscale and to anyone with a colour vision deficiency.
 */
function seatClasses(state: SeatState, interactive: boolean, isBusiness: boolean): string {
  switch (state) {
    case "selected":
      // The one place amber fills a seat. DESIGN.MD §9.
      return "cursor-pointer border-amber bg-amber font-semibold text-stage shadow-button ring-1 ring-stage/40 ring-inset";
    case "booked":
      return "cursor-not-allowed border-transparent bg-[#100d0b] text-bone-50/55 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]";
    case "held":
      return "cursor-not-allowed border-divider bg-[#221d1a] text-bone-50 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgba(236,230,220,0.11)_3px_6px)]";
    case "available":
    default: {
      const base = isBusiness
        ? "border-[rgba(217,122,44,0.34)] bg-[#31292400] bg-[#2f2723] text-bone"
        : "border-hairline bg-[#2b2624] text-bone";
      return interactive
        ? `cursor-pointer ${base} hover:-translate-y-px hover:border-outline hover:bg-[#3a3230]`
        : `cursor-not-allowed ${base} opacity-45`;
    }
  }
}

function headrestClasses(state: SeatState, isBusiness: boolean): string {
  if (state === "selected") return "bg-stage/45";
  if (state === "booked") return "bg-[rgba(236,230,220,0.10)]";
  if (state === "held") return "bg-[rgba(236,230,220,0.16)]";
  return isBusiness ? "bg-amber/70" : "bg-[rgba(236,230,220,0.22)]";
}

/* -------------------------------------------------------------------------- */
/*                             Keyboard navigation                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolve an arrow key into the seat that should receive focus.
 *
 * Skips gaps in the fuselage and steps across cabin boundaries, so holding
 * ArrowDown walks the whole aircraft rather than stopping at the galley.
 */
function navigate(
  cabins: CabinView[],
  cabinIndex: number,
  rowIndex: number,
  colIndex: number,
  key: string,
): SeatView | null {
  const step = (dRow: number, dCol: number) => {
    let c = cabinIndex;
    let r = rowIndex;
    let col = colIndex;

    for (let guard = 0; guard < 500; guard++) {
      col += dCol;
      r += dRow;

      const cabin = cabins[c];
      if (!cabin) return null;
      if (col < 0 || col >= cabin.columns.length) return null;

      if (r < 0) {
        if (c === 0) return null;
        c -= 1;
        r = cabins[c].rows.length - 1;
      } else if (r >= cabin.rows.length) {
        if (c === cabins.length - 1) return null;
        c += 1;
        r = 0;
      }

      const candidate = cabins[c]?.rows[r]?.seats[col];
      if (candidate) return candidate;
      if (dRow === 0 && dCol === 0) return null;
    }
    return null;
  };

  switch (key) {
    case "ArrowLeft":
      return step(0, -1);
    case "ArrowRight":
      return step(0, 1);
    case "ArrowUp":
      return step(-1, 0);
    case "ArrowDown":
      return step(1, 0);
    case "Home":
      return cabins[cabinIndex]?.rows[rowIndex]?.seats.find((s) => s !== null) ?? null;
    case "End": {
      const row = cabins[cabinIndex]?.rows[rowIndex]?.seats ?? [];
      for (let i = row.length - 1; i >= 0; i--) if (row[i]) return row[i];
      return null;
    }
    default:
      return null;
  }
}
