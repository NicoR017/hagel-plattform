import { isPlaceType } from "@hagel/shared";

/** A PLACE is where cars are assessed, stand and are repaired (workshop / yard). A body shop ("carrosserie") is a customer, never a place. */
export const isPlace = (s: { type: string }) => isPlaceType(s.type);
export const isBodyShop = (s: { type: string }) => s.type === "carrosserie";
