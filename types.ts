
export interface PollingCenter {
  code: string;
  name: string;
}

export interface Votes {
  [abbreviation: string]: number;
}

export interface Candidate {
  name: string;
  party: string;
  abbreviation: string;
  color: string;
}

// FIX: Added missing GroundingChunk interface to resolve import errors.
export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
}

// NEW: Added for search functionality
export interface FlatPollingCenter extends PollingCenter {
  region: string;
  district: string;
  constituency: string;
}