// FIX: Declare global variables provided by the environment to resolve TypeScript errors regarding undefined names.
declare const __app_id: string;
declare const __firebase_config: string;
declare const __initial_auth_token: string | null;

import React, { useState, useEffect, useMemo } from 'react';
// FIX: Reverted to Firebase v8 compat API to resolve module errors, as the environment seems to be using older Firebase versions.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';


import type { PollingCenter, Votes, FlatPollingCenter } from './types';
import { ELECTORAL_DATA, PERMANENT_CANDIDIDATES, POLLING_CENTER_VOTER_COUNTS } from './data/electoralData';
import Modal from './components/Modal';
import BarGraph from './components/BarGraph';
import SearchPollingCenter from './components/SearchPollingCenter';
import { WarningIcon } from './components/Icons';
import LoadingSpinner from './components/LoadingSpinner';

// Global variables provided by the Canvas environment.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

const initialVotesState = PERMANENT_CANDIDIDATES.reduce((acc, candidate) => {
    acc[candidate.abbreviation] = 0;
    return acc;
}, {} as Votes);

// --- MAIN APP COMPONENT ---

const App: React.FC = () => {
  // FIX: Use Firebase v8 compat types.
  const [db, setDb] = useState<firebase.firestore.Firestore | null>(null);
  const [user, setUser] = useState<firebase.User | null>(null);

  const [viewMode, setViewMode] = useState<'pollingCenter' | 'district' | 'national'>('pollingCenter');
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedConstituency, setSelectedConstituency] = useState('');
  const [selectedPollingCenter, setSelectedPollingCenter] = useState<PollingCenter | null>(null);

  // State for polling center view
  const [votes, setVotes] = useState<Votes>(initialVotesState);
  const [nullAndVoidVotes, setNullAndVoidVotes] = useState(0);

  // State for district view
  const [districtVotes, setDistrictVotes] = useState<Votes>(initialVotesState);
  const [districtNullAndVoid, setDistrictNullAndVoid] = useState(0);
  const [districtRegisteredVoters, setDistrictRegisteredVoters] = useState(0);
  const [isLoadingDistrictData, setIsLoadingDistrictData] = useState(false);
  
  // NEW: State for national view
  const [nationalVotes, setNationalVotes] = useState<Votes>(initialVotesState);
  const [nationalNullAndVoid, setNationalNullAndVoid] = useState(0);
  const [nationalRegisteredVoters, setNationalRegisteredVoters] = useState(0);
  const [isLoadingNationalData, setIsLoadingNationalData] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalContent, setModalContent] = useState({ title: '', message: '' });

  // Memoize the flattened list of all polling centers for search
  const allPollingCenters = useMemo<FlatPollingCenter[]>(() => {
    const centers: FlatPollingCenter[] = [];
    for (const region in ELECTORAL_DATA) {
        const regionData = ELECTORAL_DATA[region as keyof typeof ELECTORAL_DATA];
        for (const district in regionData) {
            const districtData = regionData[district as keyof typeof regionData];
            for (const constituency in districtData) {
                const pcs = districtData[constituency as keyof typeof districtData];
                pcs.forEach(pc => {
                    centers.push({ ...pc, region, district, constituency });
                });
            }
        }
    }
    return centers;
  }, []);

  // NEW: Memoize all polling center codes for the national listener
  const allPollingCenterCodes = useMemo<string[]>(() => {
    return allPollingCenters.map(pc => pc.code);
  }, [allPollingCenters]);
  
  // Firebase Initialization and Auth
  useEffect(() => {
    if (Object.keys(firebaseConfig).length > 0 && !db) {
      // FIX: Use Firebase v8 compat API for initialization and auth.
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

  // Firestore listener for polling center view
  useEffect(() => {
    if (db && selectedPollingCenter?.code && viewMode === 'pollingCenter') {
      // FIX: Use Firebase v8 compat Firestore API.
      const docRef = db.collection("results").doc(selectedPollingCenter.code);
      const unsub = docRef.onSnapshot((docSnap) => {
        if (docSnap.exists) {
          const data = docSnap.data();
          if (data) {
            const newVotes: Votes = {};
            PERMANENT_CANDIDIDATES.forEach(c => {
              newVotes[c.abbreviation] = data[c.abbreviation] || 0;
            });
            setVotes(newVotes);
            setNullAndVoidVotes(data.nullAndVoid || 0);
          }
        } else {
          setVotes(initialVotesState);
          setNullAndVoidVotes(0);
        }
      });
      return () => unsub();
    }
  }, [db, selectedPollingCenter, viewMode]);

    // Firestore listener for district view (aggregates data)
    useEffect(() => {
        if (viewMode !== 'district' || !db || !selectedRegion || !selectedDistrict) {
            setDistrictVotes(initialVotesState);
            setDistrictNullAndVoid(0);
            setDistrictRegisteredVoters(0);
            return;
        }

        setIsLoadingDistrictData(true);

        const regionData = ELECTORAL_DATA[selectedRegion as keyof typeof ELECTORAL_DATA];
        const districtData = regionData?.[selectedDistrict as keyof typeof regionData];
        if (!districtData) {
            setIsLoadingDistrictData(false);
            return;
        }

        let totalVoters = 0;
        const districtPcCodes: string[] = [];
        Object.values(districtData).forEach(constituencyPCs => {
            constituencyPCs.forEach(pc => {
                districtPcCodes.push(pc.code);
                totalVoters += POLLING_CENTER_VOTER_COUNTS[pc.code] || 0;
            });
        });
        setDistrictRegisteredVoters(totalVoters);

        // Reset state before attaching new listeners
        setDistrictVotes(initialVotesState);
        setDistrictNullAndVoid(0);

        // A local cache to hold the current data for each PC to calculate deltas
        const allPcData: { [code: string]: { votes: Votes, nullAndVoid: number } } = {};

        const unsubscribes = districtPcCodes.map(code => {
            const docRef = db.collection("results").doc(code);
            return docRef.onSnapshot((docSnap) => {
                // Get old data from cache, or assume zeros if it's the first time for this doc.
                const oldData = allPcData[code] || { votes: initialVotesState, nullAndVoid: 0 };
                
                const currentDocData: firebase.firestore.DocumentData | undefined = docSnap.exists ? docSnap.data() : undefined;
                const newVotes: Votes = {};
                PERMANENT_CANDIDIDATES.forEach(c => {
                    newVotes[c.abbreviation] = currentDocData?.[c.abbreviation] || 0;
                });
                const newNullAndVoid = currentDocData?.nullAndVoid || 0;
                
                const newData = {
                    votes: newVotes,
                    nullAndVoid: newNullAndVoid
                };

                // Update the local cache with the latest data.
                allPcData[code] = newData;

                // Calculate deltas and update the aggregated state functionally.
                setDistrictVotes(prevVotes => {
                    const updatedVotes = { ...prevVotes };
                    PERMANENT_CANDIDIDATES.forEach(c => {
                        const abbr = c.abbreviation;
                        const oldVoteCount = oldData.votes[abbr] || 0;
                        const newVoteCount = newData.votes[abbr] || 0;
                        const delta = newVoteCount - oldVoteCount;
                        updatedVotes[abbr] = (updatedVotes[abbr] || 0) + delta;
                    });
                    return updatedVotes;
                });

                setDistrictNullAndVoid(prevNullAndVoid => {
                    const delta = newData.nullAndVoid - oldData.nullAndVoid;
                    return prevNullAndVoid + delta;
                });
            });
        });

        setIsLoadingDistrictData(false);

        return () => {
            unsubscribes.forEach(unsub => unsub());
        };
    }, [db, viewMode, selectedRegion, selectedDistrict]);

    // NEW: Firestore listener for national view
    useEffect(() => {
        if (viewMode !== 'national' || !db) {
            setNationalVotes(initialVotesState);
            setNationalNullAndVoid(0);
            setNationalRegisteredVoters(0);
            return;
        }

        setIsLoadingNationalData(true);

        const totalVoters = Object.values(POLLING_CENTER_VOTER_COUNTS).reduce((sum, count) => sum + count, 0);
        setNationalRegisteredVoters(totalVoters);

        setNationalVotes(initialVotesState);
        setNationalNullAndVoid(0);

        const allPcData: { [code: string]: { votes: Votes, nullAndVoid: number } } = {};

        const unsubscribes = allPollingCenterCodes.map(code => {
            const docRef = db.collection("results").doc(code);
            return docRef.onSnapshot((docSnap) => {
                const oldData = allPcData[code] || { votes: initialVotesState, nullAndVoid: 0 };
                
                const currentDocData = docSnap.exists ? docSnap.data() : undefined;
                const newVotes: Votes = {};
                PERMANENT_CANDIDIDATES.forEach(c => {
                    newVotes[c.abbreviation] = currentDocData?.[c.abbreviation] || 0;
                });
                const newNullAndVoid = currentDocData?.nullAndVoid || 0;
                
                const newData = { votes: newVotes, nullAndVoid: newNullAndVoid };
                allPcData[code] = newData;

                setNationalVotes(prevVotes => {
                    const updatedVotes = { ...prevVotes };
                    PERMANENT_CANDIDIDATES.forEach(c => {
                        const abbr = c.abbreviation;
                        const delta = (newData.votes[abbr] || 0) - (oldData.votes[abbr] || 0);
                        updatedVotes[abbr] = (updatedVotes[abbr] || 0) + delta;
                    });
                    return updatedVotes;
                });

                setNationalNullAndVoid(prevNullAndVoid => {
                    const delta = newData.nullAndVoid - oldData.nullAndVoid;
                    return prevNullAndVoid + delta;
                });
            });
        });

        setIsLoadingNationalData(false);

        return () => {
            unsubscribes.forEach(unsub => unsub());
        };
    }, [db, viewMode, allPollingCenterCodes]);

  const resetSelections = (level: 'all' | 'region' | 'district' | 'constituency') => {
    if (level === 'all') setSelectedRegion('');
    if (level === 'all' || level === 'region') setSelectedDistrict('');
    if (level === 'all' || level === 'region' || level === 'district') setSelectedConstituency('');
    if (level === 'all' || level === 'region' || level === 'district' || level === 'constituency') setSelectedPollingCenter(null);
    setVotes(initialVotesState);
    setNullAndVoidVotes(0);
  };
  
  const handlePollingCenterSelect = (pc: FlatPollingCenter | null) => {
    if (pc) {
      setViewMode('pollingCenter');
      setSelectedRegion(pc.region);
      setSelectedDistrict(pc.district);
      setSelectedConstituency(pc.constituency);
      setSelectedPollingCenter({ code: pc.code, name: pc.name });
    } else {
      resetSelections('all');
    }
  };

  const handleVoteChange = (abbreviation: string, value: string) => {
    const newVotes = { ...votes };
    const numValue = parseInt(value, 10);
    newVotes[abbreviation] = isNaN(numValue) || numValue < 0 ? 0 : numValue;
    setVotes(newVotes);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db || !selectedPollingCenter?.code || !user) return;
    
    // Prevent submission if votes exceed voters
    if (totalVotesCast > registeredVoters && registeredVoters > 0) {
        setModalContent({ title: 'Validation Error', message: 'Total votes cast cannot exceed the number of registered voters. Please correct the values before submitting.' });
        setShowModal(true);
        return;
    }

    setIsSubmitting(true);
    try {
      // FIX: Use Firebase v8 compat Firestore API.
      const docRef = db.collection("results").doc(selectedPollingCenter.code);
      const dataToSave = { ...votes, nullAndVoid: nullAndVoidVotes, lastUpdatedBy: user.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() };
      await docRef.set(dataToSave, { merge: true });
      setModalContent({ title: 'Success', message: 'Results have been successfully submitted.' });
      setShowModal(true);
    } catch (error) {
      console.error("Error submitting results:", error);
      setModalContent({ title: 'Error', message: `Failed to submit results. ${error instanceof Error ? error.message : ''}` });
      setShowModal(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { districts, constituencies, pollingCenters } = useMemo(() => {
    const regionData = selectedRegion ? ELECTORAL_DATA[selectedRegion as keyof typeof ELECTORAL_DATA] : null;
    const districts = regionData ? Object.keys(regionData) : [];
    
    const districtData = regionData && selectedDistrict ? regionData[selectedDistrict as keyof typeof regionData] : null;
    const constituencies = districtData ? Object.keys(districtData) : [];

    const pollingCenters = districtData && selectedConstituency ? districtData[selectedConstituency as keyof typeof districtData] : [];
    
    return { districts, constituencies, pollingCenters };
  }, [selectedRegion, selectedDistrict, selectedConstituency]);

  const { registeredVoters, totalVotesCast, turnout, validationError } = useMemo(() => {
    const registeredVoters = selectedPollingCenter ? POLLING_CENTER_VOTER_COUNTS[selectedPollingCenter.code] || 0 : 0;
    const totalVotesCast = Object.values(votes).reduce((sum: number, current: number) => sum + current, 0) + nullAndVoidVotes;
    const turnout = registeredVoters > 0 ? (totalVotesCast / registeredVoters) * 100 : 0;
    const validationError = registeredVoters > 0 && totalVotesCast > registeredVoters;
    return { registeredVoters, totalVotesCast, turnout, validationError };
  }, [selectedPollingCenter, votes, nullAndVoidVotes]);

  const { districtTotalVotesCast, districtTurnout, districtValidationError } = useMemo(() => {
    if (viewMode !== 'district') return { districtTotalVotesCast: 0, districtTurnout: 0, districtValidationError: false };

    const totalVotes = Object.values(districtVotes).reduce((sum, current) => sum + current, 0) + districtNullAndVoid;
    const turnout = districtRegisteredVoters > 0 ? (totalVotes / districtRegisteredVoters) * 100 : 0;
    const validationError = districtRegisteredVoters > 0 && totalVotes > districtRegisteredVoters;

    return { districtTotalVotesCast: totalVotes, districtTurnout: turnout, districtValidationError: validationError };
  }, [viewMode, districtVotes, districtNullAndVoid, districtRegisteredVoters]);

  // NEW: Memoized calculations for National view
  const { nationalTotalVotesCast, nationalTurnout, nationalValidationError } = useMemo(() => {
    if (viewMode !== 'national') return { nationalTotalVotesCast: 0, nationalTurnout: 0, nationalValidationError: false };

    const totalVotes = Object.values(nationalVotes).reduce((sum, current) => sum + current, 0) + nationalNullAndVoid;
    const turnout = nationalRegisteredVoters > 0 ? (totalVotes / nationalRegisteredVoters) * 100 : 0;
    const validationError = nationalRegisteredVoters > 0 && totalVotes > nationalRegisteredVoters;

    return { nationalTotalVotesCast: totalVotes, nationalTurnout: turnout, nationalValidationError: validationError };
  }, [viewMode, nationalVotes, nationalNullAndVoid, nationalRegisteredVoters]);


  const barChartData = useMemo(() => {
      const sourceVotes = 
        viewMode === 'district' ? districtVotes :
        viewMode === 'national' ? nationalVotes :
        votes;

      return PERMANENT_CANDIDIDATES.map(c => ({
          name: c.abbreviation,
          party: c.party,
          value: sourceVotes[c.abbreviation] || 0,
          color: c.color
      }));
  }, [votes, districtVotes, nationalVotes, viewMode]);

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
                      onClick={() => setViewMode('pollingCenter')} 
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${viewMode === 'pollingCenter' ? 'bg-white text-blue-600 shadow' : 'bg-transparent text-gray-600 hover:bg-gray-300'}`}
                  >
                      Center
                  </button>
                  <button 
                      onClick={() => {
                          if (selectedDistrict) {
                              setViewMode('district');
                              resetSelections('constituency');
                          }
                      }}
                      disabled={!selectedDistrict}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 disabled:text-gray-400 disabled:cursor-not-allowed ${viewMode === 'district' ? 'bg-white text-blue-600 shadow' : 'bg-transparent text-gray-600 hover:bg-gray-300'}`}
                      title={!selectedDistrict ? "Select a district to enable this view" : ""}
                  >
                      District
                  </button>
                  <button 
                      onClick={() => { setViewMode('national'); resetSelections('all'); }}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${viewMode === 'national' ? 'bg-white text-blue-600 shadow' : 'bg-transparent text-gray-600 hover:bg-gray-300'}`}
                  >
                      National
                  </button>
              </div>

               <div className="space-y-4">
                 <SearchPollingCenter allPollingCenters={allPollingCenters} onSelect={handlePollingCenterSelect} />
                 <hr/>
                <select value={selectedRegion} onChange={e => { setSelectedRegion(e.target.value); resetSelections('region'); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 focus:ring-blue-500 focus:border-blue-500">
                  <option value="">-- Select Region --</option>
                  {Object.keys(ELECTORAL_DATA).map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={selectedDistrict} disabled={!selectedRegion} onChange={e => { setSelectedDistrict(e.target.value); resetSelections('district'); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 disabled:bg-gray-200 focus:ring-blue-500 focus:border-blue-500">
                   <option value="">-- Select District --</option>
                   {districts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={selectedConstituency} disabled={!selectedDistrict || viewMode === 'district' || viewMode === 'national'} onChange={e => { setSelectedConstituency(e.target.value); resetSelections('constituency'); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 disabled:bg-gray-200 focus:ring-blue-500 focus:border-blue-500">
                   <option value="">-- Select Constituency --</option>
                   {constituencies.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={selectedPollingCenter?.code || ''} disabled={!selectedConstituency || viewMode === 'district' || viewMode === 'national'} onChange={e => { const pc = pollingCenters.find(p => p.code === e.target.value) || null; setSelectedPollingCenter(pc); }} className="w-full p-2 border border-gray-300 rounded-md bg-gray-50 disabled:bg-gray-200 focus:ring-blue-500 focus:border-blue-500">
                   <option value="">-- Select Polling Center --</option>
                   {pollingCenters.map(p => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
                </select>
              </div>
            </div>

            {viewMode === 'pollingCenter' && selectedPollingCenter && (
              <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl shadow-md">
                <h3 className="text-lg font-bold mb-4">Enter Votes for: <span className="text-blue-600">{selectedPollingCenter.name}</span></h3>
                <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                  {PERMANENT_CANDIDIDATES.map(c => (
                     <div key={c.abbreviation} className="grid grid-cols-2 gap-4 items-center">
                        <label htmlFor={c.abbreviation} className="font-medium">
                          {c.name}
                          <span className="block text-xs text-gray-500">{c.party} ({c.abbreviation})</span>
                        </label>
                        <input type="number" min="0" id={c.abbreviation} value={votes[c.abbreviation] || ''} onChange={e => handleVoteChange(c.abbreviation, e.target.value)} className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500" />
                     </div>
                  ))}
                   <div className="grid grid-cols-2 gap-4 items-center border-t pt-4 mt-2">
                      <label htmlFor="nullAndVoid" className="font-semibold text-red-600">Null & Void</label>
                      <input type="number" min="0" id="nullAndVoid" value={nullAndVoidVotes || ''} onChange={e => setNullAndVoidVotes(parseInt(e.target.value) || 0)} className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500" />
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
                         'Polling Center Statistics'}
                    </h2>
                    {(isLoadingDistrictData || isLoadingNationalData) && <LoadingSpinner />}
                </div>

                {viewMode === 'pollingCenter' && (
                  <>
                    {selectedPollingCenter ? (
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
                        <p className="text-gray-500 text-center py-8">Select a polling center to view statistics.</p>
                    )}
                  </>
                )}

                {viewMode === 'district' && (
                  <>
                    {selectedDistrict ? (
                        <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold">{districtRegisteredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold ${districtValidationError ? 'text-red-500' : ''}`}>{districtTotalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${districtValidationError ? 'text-red-500' : 'text-green-600'}`}>{districtTurnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {districtValidationError && (
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
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold">{nationalRegisteredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold ${nationalValidationError ? 'text-red-500' : ''}`}>{nationalTotalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${nationalValidationError ? 'text-red-500' : 'text-green-600'}`}>{nationalTurnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {nationalValidationError && (
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
                 {(viewMode === 'pollingCenter' && !selectedPollingCenter) || (viewMode === 'district' && !selectedDistrict) ? (
                    <p className="text-gray-500 text-center py-8">
                      {viewMode === 'pollingCenter' ? 'Select a polling center to view results.' : 'Select a district to view aggregated results.'}
                    </p>
                 ) : (
                    <BarGraph 
                        data={barChartData} 
                        totalVotes={
                            viewMode === 'district' ? (districtTotalVotesCast > 0 ? districtTotalVotesCast : 1) :
                            viewMode === 'national' ? (nationalTotalVotesCast > 0 ? nationalTotalVotesCast : 1) :
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