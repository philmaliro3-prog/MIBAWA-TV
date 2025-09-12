// FIX: Declare global variables provided by the environment to resolve TypeScript errors regarding undefined names.
declare const __app_id: string;
declare const __firebase_config: string;
declare const __initial_auth_token: string | null;

import React, { useState, useEffect, useMemo } from 'react';
// FIX: Reverted to Firebase v8 compat API to resolve module errors, as the environment seems to be using older Firebase versions.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';


import type { PollingCenter, Votes } from './types';
import { ELECTORAL_DATA, PERMANENT_CANDIDIDATES, POLLING_CENTER_VOTER_COUNTS } from './data/electoralData';
import Modal from './components/Modal';
import BarGraph from './components/BarGraph';
import { WarningIcon } from './components/Icons';
import LoadingSpinner from './components/LoadingSpinner';

// Global variables provided by the Canvas environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

const initialVotesState = PERMANENT_CANDIDIDATES.reduce((acc, candidate) => {
    acc[candidate.abbreviation] = 0;
    return acc;
}, {} as Votes);

const defaultAggregatedState = {
    votes: initialVotesState,
    nullAndVoid: 0,
    registeredVoters: 0,
    constituenciesReporting: 0,
    totalConstituencies: 0,
    totalVotesCast: 0,
    turnout: 0,
    validationError: false,
};

interface ConstituencyResult {
    votes: Votes;
    nullAndVoid: number;
}

// --- MAIN APP COMPONENT ---

const App: React.FC = () => {
  // FIX: Use Firebase v8 compat types.
  const [db, setDb] = useState<firebase.firestore.Firestore | null>(null);
  const [user, setUser] = useState<firebase.User | null>(null);

  const [viewMode, setViewMode] = useState<'constituency' | 'district' | 'national'>('constituency');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedConstituency, setSelectedConstituency] = useState('');

  // State for constituency view - Caches results locally to prevent data loss on switching.
  const [allConstituencyResults, setAllConstituencyResults] = useState<{ [id: string]: ConstituencyResult }>({});

  // Single source of truth for all results from Firestore. Stored as a plain object for robust change detection.
  const [allFirestoreResults, setAllFirestoreResults] = useState<{ [id: string]: any }>({});
  const [isLoadingData, setIsLoadingData] = useState(true);
  
  // Dedicated state for aggregated views to fix stale state bugs.
  const [districtDisplayData, setDistrictDisplayData] = useState(defaultAggregatedState);
  const [nationalDisplayData, setNationalDisplayData] = useState(defaultAggregatedState);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', message: '' });

  // Helper to create a consistent, URL-safe ID for constituencies
  const generateConstituencyId = (region: string, district: string, constituency: string) => {
    return `${region}-${district}-${constituency}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  };

  const selectedConstituencyId = useMemo(() => {
    if (selectedRegion && selectedDistrict && selectedConstituency) {
        return generateConstituencyId(selectedRegion, selectedDistrict, selectedConstituency);
    }
    return null;
  }, [selectedRegion, selectedDistrict, selectedConstituency]);
  
  const currentConstituencyResult = selectedConstituencyId ? allConstituencyResults[selectedConstituencyId] : null;
  const currentVotes = currentConstituencyResult?.votes ?? initialVotesState;
  const currentNullAndVoidVotes = currentConstituencyResult?.nullAndVoid ?? 0;

  const allConstituencies = useMemo(() => {
    const constituenciesList: { region: string, district: string, constituency: string, id: string }[] = [];
    for (const region in ELECTORAL_DATA) {
        const regionData = ELECTORAL_DATA[region as keyof typeof ELECTORAL_DATA];
        for (const district in regionData) {
            const districtData = regionData[district as keyof typeof regionData];
            for (const constituency in districtData) {
                const id = generateConstituencyId(region, district, constituency);
                constituenciesList.push({ region, district, constituency, id });
            }
        }
    }
    return constituenciesList;
  }, []);
  
  // Firebase Initialization and Auth
  useEffect(() => {
    if (Object.keys(firebaseConfig).length > 0 && !db) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        const auth = firebase.auth();
        setDb(firebase.firestore());
      
        const unsubscribe = auth.onAuthStateChanged((currentUser) => {
          setUser(currentUser);
          if (!currentUser) {
            auth.signInAnonymously().catch((error) => {
              console.error("Anonymous sign-in failed:", error);
            });
          }
        });

        return () => unsubscribe();
      } catch (error) {
        console.error("Firebase initialization error:", error);
      }
    }
  }, [db]);

  // Firestore listener for constituency view (populating the form on selection)
  useEffect(() => {
    if (db && selectedConstituencyId && viewMode === 'constituency') {
      const docRef = db.collection("results").doc(selectedConstituencyId);
      const unsub = docRef.onSnapshot((docSnap) => {
        if (docSnap.exists) {
          const data = docSnap.data()!;
          const newVotes: Votes = {};
          PERMANENT_CANDIDIDATES.forEach(c => {
            newVotes[c.abbreviation] = data[c.abbreviation] || 0;
          });
          setAllConstituencyResults(prev => ({
            ...prev,
            [selectedConstituencyId]: { votes: newVotes, nullAndVoid: data.nullAndVoid || 0 }
          }));
        } else {
           setAllConstituencyResults(prev => {
                if (prev[selectedConstituencyId]) {
                    return prev; // Data exists locally (e.g., new entry), don't overwrite
                }
                return {
                    ...prev,
                    [selectedConstituencyId]: { votes: initialVotesState, nullAndVoid: 0 }
                };
            });
        }
      });
      return () => unsub();
    }
  }, [db, selectedConstituencyId, viewMode]);


  // Single, unified Firestore listener for ALL results.
  useEffect(() => {
      if (!db) return;

      setIsLoadingData(true);
      const unsubscribe = db.collection("results").onSnapshot(snapshot => {
          const resultsObj: { [id: string]: any } = {};
          snapshot.forEach(doc => {
              resultsObj[doc.id] = doc.data();
          });
          setAllFirestoreResults(resultsObj);
          setIsLoadingData(false);
      }, (error) => {
          console.error("Firestore listener error:", error);
          setIsLoadingData(false);
      });

      return () => unsubscribe();
  }, [db]);

  // FIX: Create a memoized, combined results object that merges Firestore data with local, unsaved changes.
  // This allows aggregation views (District, National) to reflect live edits before submission.
  const combinedResults = useMemo(() => {
    // Start with a copy of the definitive results from Firestore.
    const combined = JSON.parse(JSON.stringify(allFirestoreResults));

    // Overlay any local, unsaved changes. The local changes take precedence.
    for (const constituencyId in allConstituencyResults) {
        if (Object.prototype.hasOwnProperty.call(allConstituencyResults, constituencyId)) {
            const localResult = allConstituencyResults[constituencyId];
            combined[constituencyId] = {
                ...(combined[constituencyId] || {}), // Preserve other fields from Firestore (e.g., timestamp)
                ...localResult.votes,
                nullAndVoid: localResult.nullAndVoid,
            };
        }
    }
    return combined;
  }, [allFirestoreResults, allConstituencyResults]);

  // --- National Aggregation (using useEffect to prevent stale state) ---
  useEffect(() => {
      if (viewMode !== 'national') {
          return;
      }
      const result = { ...defaultAggregatedState };
      result.totalConstituencies = allConstituencies.length;
      result.registeredVoters = Object.values(POLLING_CENTER_VOTER_COUNTS).reduce((sum, count) => sum + count, 0);

      const reportingIds = Object.keys(combinedResults);
      result.constituenciesReporting = reportingIds.length;
      
      const votes = { ...initialVotesState };
      let nullAndVoid = 0;

      for (const docId of reportingIds) {
          const data = combinedResults[docId];
          if (data) {
              PERMANENT_CANDIDIDATES.forEach(c => {
                  votes[c.abbreviation] += Number(data[c.abbreviation]) || 0;
              });
              nullAndVoid += Number(data.nullAndVoid) || 0;
          }
      }

      result.votes = votes;
      result.nullAndVoid = nullAndVoid;
      result.totalVotesCast = Object.values(votes).reduce((sum, current) => sum + current, 0) + nullAndVoid;
      result.turnout = result.registeredVoters > 0 ? (result.totalVotesCast / result.registeredVoters) * 100 : 0;
      result.validationError = result.registeredVoters > 0 && result.totalVotesCast > result.registeredVoters;

      setNationalDisplayData(result);

  }, [viewMode, combinedResults, allConstituencies]);

  // --- District Aggregation (using useEffect to prevent stale state) ---
  useEffect(() => {
      if (viewMode !== 'district' || !selectedRegion || !selectedDistrict) {
          setDistrictDisplayData(defaultAggregatedState);
          return;
      }
      const result = { ...defaultAggregatedState };
      const districtConstituencies = allConstituencies.filter(c => c.region === selectedRegion && c.district === selectedDistrict);
      result.totalConstituencies = districtConstituencies.length;

      let registeredVoters = 0;
      const regionData = ELECTORAL_DATA[selectedRegion as keyof typeof ELECTORAL_DATA];
      const districtData = regionData?.[selectedDistrict as keyof typeof regionData];
      if (districtData) {
          Object.values(districtData).forEach(constituencyPCs => {
              constituencyPCs.forEach(pc => {
                  registeredVoters += POLLING_CENTER_VOTER_COUNTS[pc.code] || 0;
              });
          });
      }
      result.registeredVoters = registeredVoters;

      const votes = { ...initialVotesState };
      let nullAndVoid = 0;
      let constituenciesReporting = 0;

      for (const constituency of districtConstituencies) {
          const data = combinedResults[constituency.id];
          if (data) {
              constituenciesReporting++;
              PERMANENT_CANDIDIDATES.forEach(c => {
                  votes[c.abbreviation] += Number(data[c.abbreviation]) || 0;
              });
              nullAndVoid += Number(data.nullAndVoid) || 0;
          }
      }
      result.constituenciesReporting = constituenciesReporting;
      result.votes = votes;
      result.nullAndVoid = nullAndVoid;
      result.totalVotesCast = Object.values(votes).reduce((sum, current) => sum + current, 0) + nullAndVoid;
      result.turnout = result.registeredVoters > 0 ? (result.totalVotesCast / result.registeredVoters) * 100 : 0;
      result.validationError = result.registeredVoters > 0 && result.totalVotesCast > result.registeredVoters;

      setDistrictDisplayData(result);

  }, [viewMode, combinedResults, selectedRegion, selectedDistrict, allConstituencies]);

  const resetSelections = (level: 'all' | 'region' | 'district') => {
    if (level === 'all') {
      setSelectedRegion('');
      setSelectedDistrict('');
      setSelectedConstituency('');
    } else if (level === 'region') {
      setSelectedDistrict('');
      setSelectedConstituency('');
    } else if (level === 'district') {
      setSelectedConstituency('');
    }
  };

  const handleVoteChange = (abbreviation: string, value: string) => {
    if (!selectedConstituencyId) return;
    const numValue = parseInt(value, 10);
    const parsedValue = isNaN(numValue) || numValue < 0 ? 0 : numValue;
    
    setAllConstituencyResults(prev => {
        const currentData = prev[selectedConstituencyId] || { votes: initialVotesState, nullAndVoid: 0 };
        const newVotes = { ...currentData.votes, [abbreviation]: parsedValue };
        return {
            ...prev,
            [selectedConstituencyId]: { ...currentData, votes: newVotes }
        };
    });
  };
  
  const handleNullAndVoidVotesChange = (value: string) => {
      if (!selectedConstituencyId) return;
      const numValue = parseInt(value, 10);
      const parsedValue = isNaN(numValue) || numValue < 0 ? 0 : numValue;
      setAllConstituencyResults(prev => {
          const currentData = prev[selectedConstituencyId] || { votes: initialVotesState, nullAndVoid: 0 };
          return {
              ...prev,
              [selectedConstituencyId]: { ...currentData, nullAndVoid: parsedValue }
          };
      });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedConstituencyId || !user || !currentConstituencyResult) return;
    
    if (totalVotesCast > registeredVoters && registeredVoters > 0) {
        setModalContent({ title: 'Validation Error', message: 'Total votes cast cannot exceed the number of registered voters for this constituency. Please correct the values before submitting.' });
        setShowModal(true);
        return;
    }

    setIsSubmitting(true);
    try {
      const docRef = db.collection("results").doc(selectedConstituencyId);
      const dataToSave = { 
        ...currentConstituencyResult.votes, 
        nullAndVoid: currentConstituencyResult.nullAndVoid, 
        lastUpdatedBy: user.uid, 
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        region: selectedRegion,
        district: selectedDistrict,
        constituency: selectedConstituency,
      };
      await docRef.set(dataToSave, { merge: true });
      setModalContent({ title: 'Success', message: `Results for ${selectedConstituency} have been successfully submitted.` });
      setShowModal(true);
    } catch (error) {
      console.error("Error submitting results:", error);
      setModalContent({ title: 'Error', message: `Failed to submit results. ${error instanceof Error ? error.message : ''}` });
      setShowModal(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { districts, constituencies } = useMemo(() => {
    const regionData = selectedRegion ? ELECTORAL_DATA[selectedRegion as keyof typeof ELECTORAL_DATA] : null;
    const districts = regionData ? Object.keys(regionData) : [];
    
    const districtData = regionData && selectedDistrict ? regionData[selectedDistrict as keyof typeof regionData] : null;
    const constituencies = districtData ? Object.keys(districtData) : [];
    
    return { districts, constituencies };
  }, [selectedRegion, selectedDistrict]);

  const { registeredVoters, totalVotesCast, turnout, validationError } = useMemo(() => {
    if (viewMode !== 'constituency' || !selectedRegion || !selectedDistrict || !selectedConstituency) {
      return { registeredVoters: 0, totalVotesCast: 0, turnout: 0, validationError: false };
    }
    const regionData = ELECTORAL_DATA[selectedRegion as keyof typeof ELECTORAL_DATA];
    const districtData = regionData ? regionData[selectedDistrict as keyof typeof regionData] : null;
    const constituencyPCs = districtData ? districtData[selectedConstituency as keyof typeof districtData] : [];

    const voters = (constituencyPCs || []).reduce((sum, pc) => {
        return sum + (POLLING_CENTER_VOTER_COUNTS[pc.code] || 0);
    }, 0);

    const votesCast = Object.values(currentVotes).reduce((sum: number, current: number) => sum + current, 0) + currentNullAndVoidVotes;
    const calculatedTurnout = voters > 0 ? (votesCast / voters) * 100 : 0;
    const isInvalid = voters > 0 && votesCast > voters;

    return { registeredVoters: voters, totalVotesCast: votesCast, turnout: calculatedTurnout, validationError: isInvalid };
  }, [viewMode, selectedRegion, selectedDistrict, selectedConstituency, currentVotes, currentNullAndVoidVotes]);

  const barChartData = useMemo(() => {
      const sourceVotes = 
        viewMode === 'district' ? districtDisplayData.votes :
        viewMode === 'national' ? nationalDisplayData.votes :
        currentVotes;

      return PERMANENT_CANDIDIDATES.map(c => ({
          name: c.abbreviation,
          party: c.party,
          value: sourceVotes[c.abbreviation] || 0,
          color: c.color
      }));
  }, [currentVotes, districtDisplayData, nationalDisplayData, viewMode]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 p-4 sm:p-6 lg:p-8">
      <Modal show={showModal} onClose={() => setShowModal(false)} title={modalContent.title} message={modalContent.message} />
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Mibawa TV Election Console</h1>
          <p className="text-lg text-gray-600 mt-1">Live Election Results Operator Panel</p>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Selections & Data Entry */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-md">
              <h2 className="text-xl font-bold mb-2">View & Select</h2>
              <div className="flex items-center justify-center space-x-1 p-1 bg-gray-200 rounded-lg my-4">
                  <button 
                      onClick={() => setViewMode('constituency')} 
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${viewMode === 'constituency' ? 'bg-white text-blue-600 shadow' : 'bg-transparent text-gray-600 hover:bg-gray-300'}`}
                  >
                      Constituency
                  </button>
                  <button 
                      onClick={() => {
                          setViewMode('district');
                          setSelectedConstituency(''); // Clear specific constituency for district view
                      }}
                      disabled={!selectedDistrict}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 disabled:text-gray-400 disabled:cursor-not-allowed ${viewMode === 'district' ? 'bg-white text-blue-600 shadow' : 'bg-transparent text-gray-600 hover:bg-gray-300'}`}
                      title={!selectedDistrict ? "Select a district to enable this view" : ""}
                  >
                      District
                  </button>
                  <button 
                      onClick={() => {
                          setViewMode('national');
                          resetSelections('all');
                      }}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${viewMode === 'national' ? 'bg-white text-blue-600 shadow' : 'bg-transparent text-gray-600 hover:bg-gray-300'}`}
                  >
                      National
                  </button>
              </div>

               <div className="space-y-4">
                {(viewMode === 'constituency' || viewMode === 'district') && (
                  <>
                    <select value={selectedRegion} onChange={e => { setSelectedRegion(e.target.value); resetSelections('region'); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 focus:ring-blue-500 focus:border-blue-500">
                      <option value="">-- Select Region --</option>
                      {Object.keys(ELECTORAL_DATA).map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select value={selectedDistrict} disabled={!selectedRegion} onChange={e => { setSelectedDistrict(e.target.value); resetSelections('district'); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 disabled:bg-gray-200 focus:ring-blue-500 focus:border-blue-500">
                       <option value="">-- Select District --</option>
                       {districts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </>
                )}
                
                {viewMode === 'constituency' && (
                  <select value={selectedConstituency} disabled={!selectedDistrict} onChange={e => { setSelectedConstituency(e.target.value); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 disabled:bg-gray-200 focus:ring-blue-500 focus:border-blue-500">
                     <option value="">-- Select Constituency --</option>
                     {constituencies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}

                {viewMode === 'national' && (
                  <div className="text-center p-4 bg-gray-100 rounded-md">
                      <p className="text-sm text-gray-600 font-medium">Viewing national results. No specific location selection is needed.</p>
                  </div>
                )}
              </div>
            </div>

            {viewMode === 'constituency' && selectedConstituency && (
              <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-md">
                <h3 className="text-lg font-bold mb-4">Enter Votes for: <span className="text-blue-600">{selectedConstituency}</span></h3>
                <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                  {PERMANENT_CANDIDIDATES.map(c => (
                     <div key={c.abbreviation} className="grid grid-cols-2 gap-4 items-center">
                        <label htmlFor={c.abbreviation} className="font-medium">
                          {c.name}
                          <span className="block text-xs text-gray-500">{c.party} ({c.abbreviation})</span>
                        </label>
                        <input type="number" min="0" id={c.abbreviation} value={currentVotes[c.abbreviation] || ''} onChange={e => handleVoteChange(c.abbreviation, e.target.value)} className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500" />
                     </div>
                  ))}
                   <div className="grid grid-cols-2 gap-4 items-center border-t pt-4 mt-2">
                      <label htmlFor="nullAndVoid" className="font-semibold text-red-600">Null & Void</label>
                      <input 
                        type="number" 
                        min="0" 
                        id="nullAndVoid" 
                        value={currentNullAndVoidVotes || ''} 
                        onChange={e => handleNullAndVoidVotesChange(e.target.value)} 
                        className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500" 
                      />
                   </div>
                </div>
                 <button type="submit" disabled={isSubmitting} className="mt-6 w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center">
                    {isSubmitting ? <><LoadingSpinner /> Submitting...</> : 'Submit Results'}
                 </button>
              </form>
            )}
          </div>
          
          {/* Right Column: Stats & Graph */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-md">
                <div className="flex items-center justify-between mb-4 border-b pb-2">
                    <h2 className="text-xl font-bold">
                        {viewMode === 'district' ? `District Statistics: ${selectedDistrict || 'N/A'}` : 
                         viewMode === 'national' ? 'National Statistics' : 
                         'Constituency Statistics'}
                    </h2>
                    {isLoadingData && <LoadingSpinner />}
                </div>

                {viewMode === 'constituency' && (
                  <>
                    {selectedConstituency ? (
                        <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold">{registeredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold ${validationError ? 'text-red-500' : ''}`}>{totalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${validationError ? 'text-red-500' : 'text-green-600'}`}>{turnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {validationError && (
                          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-3">
                            <WarningIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                            <p className="text-sm font-medium text-red-700">Warning: Total votes cast exceed the number of registered voters.</p>
                          </div>
                        )}
                        </>
                    ) : (
                        <p className="text-gray-500 text-center py-8">Select a constituency to view statistics.</p>
                    )}
                  </>
                )}

                {viewMode === 'district' && (
                  <>
                    {selectedDistrict ? (
                        <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 text-sm">Reporting</p>
                                <p className="text-3xl font-bold">{districtDisplayData.constituenciesReporting} <span className="text-xl text-gray-500">/ {districtDisplayData.totalConstituencies}</span></p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold">{districtDisplayData.registeredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold ${districtDisplayData.validationError ? 'text-red-500' : ''}`}>{districtDisplayData.totalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${districtDisplayData.validationError ? 'text-red-500' : 'text-green-600'}`}>{districtDisplayData.turnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {districtDisplayData.validationError && (
                          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-3">
                            <WarningIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                            <p className="text-sm font-medium text-red-700">Warning: Total district votes cast exceed the number of registered voters.</p>
                          </div>
                        )}
                        </>
                    ) : (
                        <p className="text-gray-500 text-center py-8">Select a district to view aggregated statistics.</p>
                    )}
                  </>
                )}

                {viewMode === 'national' && (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 text-sm">Reporting</p>
                                <p className="text-3xl font-bold">{nationalDisplayData.constituenciesReporting} <span className="text-xl text-gray-500">/ {nationalDisplayData.totalConstituencies}</span></p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold">{nationalDisplayData.registeredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold ${nationalDisplayData.validationError ? 'text-red-500' : ''}`}>{nationalDisplayData.totalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${nationalDisplayData.validationError ? 'text-red-500' : 'text-green-600'}`}>{nationalDisplayData.turnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {nationalDisplayData.validationError && (
                          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-3">
                            <WarningIcon className="w-6 h-6 text-red-500 flex-shrink-0" />
                            <p className="text-sm font-medium text-red-700">Warning: Total national votes cast exceed the number of registered voters.</p>
                          </div>
                        )}
                    </>
                )}
            </div>
             <div className="bg-white p-6 rounded-xl shadow-md">
                <h2 className="text-xl font-bold mb-4 border-b pb-2">
                  {viewMode === 'district' ? `District Results: ${selectedDistrict || 'N/A'}` : 
                   viewMode === 'national' ? 'National Results' :
                   'Results Graph'}
                </h2>
                 {(viewMode === 'constituency' && !selectedConstituency) || (viewMode === 'district' && !selectedDistrict) ? (
                    <p className="text-gray-500 text-center py-8">
                      {viewMode === 'constituency' ? 'Select a constituency to view results.' : 'Select a district to view aggregated results.'}
                    </p>
                 ) : (
                    <BarGraph 
                        data={barChartData} 
                        totalVotes={
                            viewMode === 'district' ? (districtDisplayData.totalVotesCast > 0 ? districtDisplayData.totalVotesCast : 1) :
                            viewMode === 'national' ? (nationalDisplayData.totalVotesCast > 0 ? nationalDisplayData.totalVotesCast : 1) :
                            (totalVotesCast > 0 ? totalVotesCast : 1)
                        } 
                    />
                 )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;