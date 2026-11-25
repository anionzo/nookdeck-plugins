/** Which tile gets which view, and how much fits on it. The tile is given in grid cells. */
export interface Tile { w: number; h: number }

/** From this width the tile shows the week. */
export const WEEK_MIN_W = 6;
export const isWeek = (tile?: Tile): boolean => !!tile && tile.w >= WEEK_MIN_W;
/** From four by three it shows the month beside the list. */
export const isAgenda = (tile?: Tile): boolean => !!tile && !isWeek(tile) && tile.w >= 4 && tile.h >= 3;

/** How many events a list shows on a tile of this height; the tile's own setting can only lower it. */
export function listRows(tile: Tile | undefined, most: number): number {
  // without a tile size (a preview, an older Nookdeck) the list stays short
  const fits = !tile ? 4 : tile.h <= 1 ? 2 : tile.h === 2 ? 4 : tile.h === 3 ? 7 : 10;
  return Math.min(fits, most);
}
