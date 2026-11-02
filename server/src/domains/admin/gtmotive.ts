/**
 * GT Motive integration (Spain): link a vehicle to a GT Motive claim, push the estimate and the photos, read the status back.
 * Only the interface exists for now: nothing calls GT Motive and nothing is stored. The API connection comes later.
 */
export interface GtMotiveClaim { claimId: string; status: string; updatedAt: string }

export interface GtMotive {
  /** link a vehicle to an existing GT Motive claim */
  link(vehicleId: string, claimId: string): Promise<void>;
  /** send the estimate and the photos of a vehicle */
  push(vehicleId: string): Promise<void>;
  /** current status of the linked claim, null when not linked */
  status(vehicleId: string): Promise<GtMotiveClaim | null>;
}

/** The only implementation today: it refuses everything, so a call by mistake cannot be mistaken for a working link. */
export const gtMotiveNotAvailable: GtMotive = {
  async link() { throw new Error("gtmotive_unavailable"); },
  async push() { throw new Error("gtmotive_unavailable"); },
  async status() { return null; },
};
