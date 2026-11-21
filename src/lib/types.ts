export type LatLon = { lat: number; lon: number };

/** A geocoded point. `postcode` is empty when the point came from GPS and no postcode was near. */
export type Place = LatLon & { postcode: string; area?: string; country?: string };

export type Job = {
  id: string;
  /** Job number from the sheet. May be empty for a job typed in by hand. */
  ref: string;
  collect: string;
  /** Where the car is going. On a carryover this is for a later day and may be empty. */
  deliver: string;
  /** The car goes home with the driver tonight and is delivered another day. */
  carryover: boolean;
  reg?: string;
  startTime?: string;
  liftFrom?: string;

  /* History and pay. Used for a plate driver's own jobs. */
  /** The day the job is planned for, as YYYY-MM-DD. */
  date?: string;
  /** Not set means still to do. */
  status?: 'done' | 'failed';
  inspection?: boolean;
  /** Miles printed on the job sheet. */
  sheetMiles?: number;
  /** Road miles the planner worked out. */
  roadMiles?: number;
  /** Miles the driver typed in, which win over the other two. */
  paidMiles?: number;
  /** What was offered for a failed job. */
  failedPay?: number;
  /** Any other amount, added to the pay. */
  extraPay?: number;
  /** On a delivery added for an earlier carryover: that carryover's id. */
  carriedFrom?: string;
  /** On a carryover: the day its delivery was added, so it is not offered again. */
  deliveredOn?: string;
  /** The rates in force when the job was marked done or failed, so later rate changes do not rewrite it. */
  rates?: import('./pay').Rates;
};

export type Coords = [number, number][]; // [lon, lat]

export type TransitMode = 'WALK' | 'BUS' | 'RAIL' | 'METRO' | 'TRAM' | 'FERRY' | 'OTHER';

export type TransitPart = {
  mode: TransitMode;
  label: string;
  from: string;
  to: string;
  start: number;
  end: number;
  headsign?: string;
  coords: Coords;
};

export type LegKind = 'job' | 'lift' | 'transit' | 'unknown';

export type Leg = {
  id: string;
  kind: LegKind;
  /** Set on job legs. */
  jobId?: string;
  jobNo?: number;
  carryover?: boolean;
  from: Place;
  to: Place;
  /** True when this leg ends at the driver's home. */
  toHome?: boolean;
  start: number;
  end: number;
  miles: number;
  mins: number;
  coords: Coords;
  parts?: TransitPart[];
  /** What a public transport leg is likely to cost. */
  fare?: import('./fares').FareEstimate;
};

export type DriverPlan = {
  mode: 'solo' | 'lift';
  order: string[];
  legs: Leg[];
  leave: number;
  finish: number;
  jobMiles: number;
  jobMins: number;
  /** Time spent getting between jobs (lift car, or bus, train and foot). */
  gapMins: number;
  /** Road miles between jobs. Only meaningful in lift mode. */
  gapMiles: number;
  ordersChecked: number;
  warnings: string[];
  /** Likely cost of the day's public transport. Solo mode only. */
  fare?: import('./fares').FareEstimate;
};

export type TeamDriver = {
  id: string;
  callSign: string;
  name: string;
  jobs: Job[];
  /** True when the driver makes their own way home after their last job, so the lift car does not pick them up. */
  ownWayHome?: boolean;
};

export type LiftStopKind = 'start' | 'drop' | 'pick' | 'end';

export type LiftStop = {
  id: string;
  kind: LiftStopKind;
  driverId?: string;
  jobId?: string;
  place: Place;
  arrive: number;
  depart: number;
  /** Minutes the lift car waits here for the driver to arrive. */
  carWaitMin: number;
  /** Minutes the driver waited here for the lift car. */
  driverWaitMin: number;
  /** Driver ids in the car when it leaves this stop. */
  onBoard: string[];
  /** Road leg from the previous stop to this one. */
  miles: number;
  mins: number;
  coords: Coords;
};

export type LaneSegment = {
  kind: 'car' | 'job' | 'wait' | 'handover';
  start: number;
  end: number;
  jobId?: string;
};

export type LaneJob = {
  jobId: string;
  jobNo: number;
  carryover: boolean;
  from: Place;
  to: Place | null;
  droppedAt: number;
  setOffAt: number;
  arriveAt: number;
  readyAt: number;
  pickedAt: number | null;
  /** True for the last job of a driver who makes their own way home from the delivery. */
  ownWay: boolean;
  miles: number;
  mins: number;
  coords: Coords;
};

export type DriverLane = {
  driverId: string;
  segments: LaneSegment[];
  jobs: LaneJob[];
  /** When this driver's part in the lift run ends. */
  finish: number;
  waitMin: number;
};

export type LiftPlan = {
  stops: LiftStop[];
  lanes: DriverLane[];
  leave: number;
  finish: number;
  carMiles: number;
  carDriveMins: number;
  carWaitMin: number;
  driverWaitMin: number;
  /** False when the search was cut short, so the run is good but not proven shortest. */
  proven: boolean;
  warnings: string[];
};
