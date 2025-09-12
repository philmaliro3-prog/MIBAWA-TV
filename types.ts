
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

// NEW: Add Constituency type for new search component
export interface Constituency {
  region: string;
  district: string;
  constituency: string;
  id: string;
  status?: 'Submitted' | 'In Progress' | 'Not Started';
}

// FIX: Add GroundingChunk interface for Gemini API search grounding results.
export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
}
