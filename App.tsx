// FIX: Declare global variables provided by the environment to resolve TypeScript errors regarding undefined names.
declare const __app_id: string;
declare const __firebase_config: string;
declare const __initial_auth_token: string | null;

import React, { useState, useEffect, useMemo, useRef } from 'react';
// FIX: Reverted to Firebase v8 compat API to resolve module errors, as the environment seems to be using older Firebase versions.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';


import type { PollingCenter, Votes, Constituency } from './types';
import { ELECTORAL_DATA, PERMANENT_CANDIDIDATES, POLLING_CENTER_VOTER_COUNTS } from './data/electoralData';
import Modal from './components/Modal';
import BarGraph from './components/BarGraph';
import { WarningIcon, EnterFullscreenIcon, ExitFullscreenIcon, TrashIcon, SunIcon, MoonIcon, CloseIcon, InformationCircleIcon } from './components/Icons';
import LoadingSpinner from './components/LoadingSpinner';
import SearchableDropdown from './components/SearchableDropdown';


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

  // State for fullscreen and theme
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('theme')) {
        return localStorage.getItem('theme') as 'light' | 'dark';
    }
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
  });
  
  // State for reset functionality
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const cancelResetButtonRef = useRef<HTMLButtonElement>(null);
  const confirmResetButtonRef = useRef<HTMLButtonElement>(null);

  // NEW: State for error handling
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const [listenerError, setListenerError] = useState<string | null>(null);

  // NEW: Helper to generate user-friendly Firebase error messages.
  const getFriendlyFirebaseErrorMessage = (error: any): string => {
    console.error("Firebase Error:", error); // Keep logging the original error for debugging
    if (error && error.code) {
        switch (error.code) {
            case 'permission-denied':
                return 'Permission Denied: You do not have the required permissions to perform this action. Please contact your administrator.';
            case 'unavailable':
                return 'Service Unavailable: Could not connect to the database. Please check your internet connection and try again.';
            case 'deadline-exceeded':
                return 'Network Timeout: The request took too long to complete. Please check your internet connection and try again.';
            case 'unauthenticated':
                return 'Authentication Error: You are not signed in. Please refresh the page to try again.';
            case 'not-found':
                 return 'Data Not Found: The requested data could not be found in the database.';
            default:
                return `An unexpected error occurred (${error.code}). Please try again.`;
        }
    }
     if (error instanceof Error) {
        return error.message;
    }
    return 'An unknown error occurred. Please check the console for more details.';
  };
  
  // Effect to apply theme class and save preference
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

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
    const constituenciesList: Omit<Constituency, 'status'>[] = [];
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

  const constituenciesWithStatus: Constituency[] = useMemo(() => {
    return allConstituencies.map(c => {
        const hasLocalData = allConstituencyResults[c.id] && (Object.values(allConstituencyResults[c.id].votes).some(v => v > 0) || allConstituencyResults[c.id].nullAndVoid > 0);
        const isSubmitted = !!allFirestoreResults[c.id];
        
        let status: Constituency['status'] = 'Not Started';
        if (isSubmitted) {
            status = 'Submitted';
        } else if (hasLocalData) {
            status = 'In Progress';
        }

        return { ...c, status };
    });
  }, [allConstituencies, allFirestoreResults, allConstituencyResults]);
  
  
  // --- Start of location selection logic ---
  const regions = useMemo(() => Object.keys(ELECTORAL_DATA), []);

  const districtsForSelectedRegion = useMemo(() => {
    if (!selectedRegion) return [];
    const regionData = ELECTORAL_DATA[selectedRegion as keyof typeof ELECTORAL_DATA];
    return regionData ? Object.keys(regionData) : [];
  }, [selectedRegion]);
  
  const constituenciesForSelectedDistrict = useMemo(() => {
    if (!selectedRegion || !selectedDistrict) return [];
    return constituenciesWithStatus.filter(c => c.region === selectedRegion && c.district === selectedDistrict);
  }, [selectedRegion, selectedDistrict, constituenciesWithStatus]);

  const handleRegionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newRegion = e.target.value;
    setSelectedRegion(newRegion);
    setSelectedDistrict('');
    setSelectedConstituency('');
  };

  const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDistrict = e.target.value;
    setSelectedDistrict(newDistrict);
    setSelectedConstituency(''); // Reset constituency
  };
  
  const handleConstituencyChange = (constituencyName: string) => {
    setSelectedConstituency(constituencyName);
    if(constituencyName) {
      setViewMode('constituency');
    }
  };
  // --- End of location selection logic ---

  
  // Firebase Initialization and Auth with robust error handling
  useEffect(() => {
    if (Object.keys(firebaseConfig).length > 0 && !db) {
      try {
        if (!firebase.apps.length) {
          firebase.initializeApp(firebaseConfig);
        }
        const auth = firebase.auth();
        setDb(firebase.firestore());
      
        auth.onAuthStateChanged((currentUser) => {
          setUser(currentUser);
          if (!currentUser) {
            auth.signInAnonymously().catch((error) => {
               setInitializationError(
                `Critical: Anonymous sign-in failed. The application cannot save data. Reason: ${getFriendlyFirebaseErrorMessage(error)}`
              );
            });
          }
        });

      } catch (error) {
        setInitializationError(
            `Critical: Firebase initialization failed. The application cannot connect to the database. Reason: ${getFriendlyFirebaseErrorMessage(error)}`
        );
      }
    }
  }, []); // Changed dependency from [db] to [] to run only once.

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
      }, (error) => {
          setListenerError(`Failed to load data for ${selectedConstituency}. Reason: ${getFriendlyFirebaseErrorMessage(error)}`);
      });
      return () => unsub();
    }
  }, [db, selectedConstituencyId, viewMode]);


  // Single, unified Firestore listener for ALL results.
  useEffect(() => {
      if (!db) return;

      setIsLoadingData(true);
      const unsubscribe = db.collection("results").onSnapshot(snapshot => {
          setListenerError(null); // Clear previous errors on successful fetch
          const resultsObj: { [id: string]: any } = {};
          snapshot.forEach(doc => {
              resultsObj[doc.id] = doc.data();
          });
          setAllFirestoreResults(resultsObj);
          setIsLoadingData(false);
      }, (error) => {
          setListenerError(`Live data update failed. Displayed data might be stale. Reason: ${getFriendlyFirebaseErrorMessage(error)}`);
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

  // Accessibility: Focus management for reset confirmation modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowResetConfirmModal(false);
        resetButtonRef.current?.focus();
      }
      // Trap focus within the modal
      if (e.key === 'Tab' && showResetConfirmModal) {
        const firstElement = cancelResetButtonRef.current;
        const lastElement = confirmResetButtonRef.current;
        if (e.shiftKey) { // Shift+Tab
          if (document.activeElement === firstElement) {
            lastElement?.focus();
            e.preventDefault();
          }
        } else { // Tab
          if (document.activeElement === lastElement) {
            firstElement?.focus();
            e.preventDefault();
          }
        }
      }
    };
    
    if (showResetConfirmModal) {
      // Delay focus slightly to ensure modal is rendered
      setTimeout(() => cancelResetButtonRef.current?.focus(), 50);
      document.addEventListener('keydown', handleKeyDown);
    }
    
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showResetConfirmModal]);


  const resetSelections = () => {
      setSelectedRegion('');
      setSelectedDistrict('');
      setSelectedConstituency('');
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

  const handleResetConstituencyForm = () => {
    if (!selectedConstituencyId) return;
    setAllConstituencyResults(prev => ({
        ...prev,
        [selectedConstituencyId]: { votes: initialVotesState, nullAndVoid: 0 }
    }));
  };

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
      setModalContent({ title: 'Submission Error', message: getFriendlyFirebaseErrorMessage(error) });
      setShowModal(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAllVotes = async () => {
    if (!db || !user) {
        // Fix: Check for user authentication before proceeding.
        setModalContent({ title: 'Error', message: 'Database connection not available or user not authenticated. Please wait a moment and try again.' });
        setShowModal(true);
        setIsResetting(false); // Make sure to reset the button state
        setShowResetConfirmModal(false);
        return;
    }

    setIsResetting(true);
    setShowResetConfirmModal(false);

    try {
        const resultsCollection = db.collection("results");
        const snapshot = await resultsCollection.get();

        if (snapshot.empty) {
            setModalContent({ title: 'Info', message: 'There are no results to reset.' });
            setShowModal(true);
            setIsResetting(false);
            resetButtonRef.current?.focus();
            return;
        }

        // Use a batch to delete all documents for efficiency
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        // Clear local state as well
        setAllConstituencyResults({});

        setModalContent({ title: 'Success', message: 'All election results have been reset.' });
        setShowModal(true);
    } catch (error) {
        setModalContent({ title: 'Reset Error', message: getFriendlyFirebaseErrorMessage(error) });
    } finally {
        setIsResetting(false);
        resetButtonRef.current?.focus();
    }
  };

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

  // NEW: Memoized audit information for the currently selected constituency.
  const auditInfo = useMemo(() => {
    if (selectedConstituencyId && allFirestoreResults[selectedConstituencyId]) {
      const result = allFirestoreResults[selectedConstituencyId];
      // Firestore timestamp can be null if not yet set by server, so check for `toDate` method.
      if (result.timestamp && typeof result.timestamp.toDate === 'function') {
        const date = result.timestamp.toDate();
        const formattedDate = date.toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        const operatorId = result.lastUpdatedBy ? ` by Operator ${String(result.lastUpdatedBy).substring(0, 8)}...` : '';
        return `Last saved${operatorId} on ${formattedDate}`;
      }
    }
    return null;
  }, [selectedConstituencyId, allFirestoreResults]);


  return (
    <div className={`bg-gray-50 text-gray-800 dark:bg-slate-900 dark:text-slate-200 ${isFullscreen ? 'p-2' : 'p-4 sm:p-6 lg:p-8'}`}>
      {initializationError && (
          <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col justify-center items-center z-[100] text-white p-8 text-center">
              <WarningIcon className="w-16 h-16 text-red-500 mb-4" />
              <h1 className="text-3xl font-bold mb-2">Application Error</h1>
              <p className="max-w-2xl">{initializationError}</p>
              <p className="mt-4 text-slate-400">Please refresh the page to try again. If the problem persists, contact technical support.</p>
          </div>
      )}

      <Modal show={showModal} onClose={() => setShowModal(false)} title={modalContent.title} message={modalContent.message} />
      
      {showResetConfirmModal && (
          <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 transition-opacity duration-300 animate-fade-in">
              <style>{`
                  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                  .animate-fade-in { animation: fadeIn 0.2s ease-out forwards; }
              `}</style>
              <div 
                role="alertdialog" 
                aria-modal="true" 
                aria-labelledby="reset-modal-title" 
                aria-describedby="reset-modal-description"
                className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 w-full max-w-md transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale"
              >
                  <style>{`
                      @keyframes fadeInScale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                      .animate-fade-in-scale { animation: fadeInScale 0.3s forwards cubic-bezier(0.16, 1, 0.3, 1); }
                  `}</style>
                  <h3 id="reset-modal-title" className="text-xl font-bold text-red-700 dark:text-red-500">Confirm Reset</h3>
                  <p id="reset-modal-description" className="mt-2 text-gray-600 dark:text-slate-300">Are you sure you want to delete ALL election results data? This action is permanent and cannot be undone.</p>
                  <div className="mt-6 flex justify-end gap-4">
                      <button
                          ref={cancelResetButtonRef}
                          onClick={() => {
                            setShowResetConfirmModal(false);
                            resetButtonRef.current?.focus();
                          }}
                          className="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500 dark:focus:ring-slate-400 dark:focus:ring-offset-slate-800"
                      >
                          Cancel
                      </button>
                      <button
                          ref={confirmResetButtonRef}
                          onClick={handleResetAllVotes}
                          className="px-4 py-2 bg-red-600 text-white font-semibold rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                          Yes, Reset All
                      </button>
                  </div>
              </div>
          </div>
      )}

      <div className={isFullscreen ? 'max-w-full' : 'max-w-7xl mx-auto'}>
        {listenerError && (
            <div role="alert" className="flex items-center justify-between gap-4 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 text-yellow-800 dark:text-yellow-200 px-4 py-3 rounded-lg relative mb-6">
                <div className="flex items-center gap-3">
                    <WarningIcon className="w-6 h-6 flex-shrink-0" aria-hidden="true" />
                    <span className="font-medium">{listenerError}</span>
                </div>
                <button 
                    onClick={() => setListenerError(null)} 
                    aria-label="Dismiss" 
                    className="p-1 rounded-full hover:bg-yellow-200 dark:hover:bg-yellow-800/50"
                >
                    <CloseIcon className="w-5 h-5" />
                </button>
            </div>
        )}
        <header className={`mb-8 ${isFullscreen ? 'hidden' : ''}`}>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-slate-50">Mibawa TV Election Console</h1>
          <p className="text-lg text-gray-600 dark:text-slate-400 mt-1">Live Election Results Operator Panel</p>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Selections & Data Entry */}
          <div className={`${isFullscreen ? 'hidden' : ''} lg:col-span-1 space-y-6`}>
            <div className="bg-white dark:bg-slate-800/50 dark:border dark:border-slate-700 p-6 rounded-xl shadow-md">
              <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-slate-100">View & Select</h2>
              <div role="group" aria-label="Select view mode" className="flex items-center justify-center space-x-1 p-1 bg-gray-200 dark:bg-slate-900 rounded-lg mb-4">
                  <button 
                      onClick={() => setViewMode('constituency')} 
                      aria-pressed={viewMode === 'constituency'}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${viewMode === 'constituency' ? 'bg-white dark:bg-blue-600 dark:text-white shadow' : 'bg-transparent text-gray-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-700'}`}
                  >
                      Constituency
                  </button>
                  <button 
                      onClick={() => {
                          setViewMode('district');
                      }}
                      disabled={!selectedDistrict}
                      aria-pressed={viewMode === 'district'}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 disabled:text-gray-400 dark:disabled:text-slate-500 disabled:cursor-not-allowed ${viewMode === 'district' ? 'bg-white dark:bg-blue-600 dark:text-white shadow' : 'bg-transparent text-gray-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-700'}`}
                      title={!selectedDistrict ? "Select a district to enable this view" : ""}
                  >
                      District
                  </button>
                  <button 
                      onClick={() => {
                          setViewMode('national');
                          resetSelections();
                      }}
                      aria-pressed={viewMode === 'national'}
                      className={`w-1/3 px-3 py-2 text-sm font-semibold rounded-md transition-colors duration-200 ${viewMode === 'national' ? 'bg-white dark:bg-blue-600 dark:text-white shadow' : 'bg-transparent text-gray-600 dark:text-slate-300 hover:bg-gray-300 dark:hover:bg-slate-700'}`}
                  >
                      National
                  </button>
              </div>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="region-select" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Region</label>
                        <select
                            id="region-select"
                            value={selectedRegion}
                            onChange={handleRegionChange}
                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                        >
                            <option value="">-- Select Region --</option>
                            {regions.map(region => <option key={region} value={region}>{region}</option>)}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="district-select" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">District</label>
                        <select
                            id="district-select"
                            value={selectedDistrict}
                            onChange={handleDistrictChange}
                            disabled={!selectedRegion}
                            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                        >
                            <option value="">-- Select District --</option>
                            {districtsForSelectedRegion.map(district => <option key={district} value={district}>{district}</option>)}
                        </select>
                    </div>
                    
                    <div>
                        <label htmlFor="constituency-select" className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Constituency</label>
                        <SearchableDropdown 
                            options={constituenciesForSelectedDistrict}
                            value={selectedConstituency}
                            onChange={handleConstituencyChange}
                            disabled={!selectedDistrict}
                            placeholder="-- Select Constituency --"
                        />
                    </div>
                </div>
                
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
                    <h4 className="text-xs font-bold uppercase text-gray-500 dark:text-slate-400 mb-2">Legend</h4>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-slate-400" aria-hidden="true"></span>
                            <span className="text-gray-600 dark:text-slate-300">Not Started</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-yellow-500" aria-hidden="true"></span>
                            <span className="text-gray-600 dark:text-slate-300">In Progress</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full bg-green-500" aria-hidden="true"></span>
                            <span className="text-gray-600 dark:text-slate-300">Submitted</span>
                        </div>
                    </div>
                </div>


               <div className="mt-6 pt-4 border-t border-gray-200 dark:border-slate-700">
                  <button
                    ref={resetButtonRef}
                    type="button"
                    onClick={() => setShowResetConfirmModal(true)}
                    disabled={isResetting || !user}
                    title={!user ? 'Connecting to database...' : 'Reset all vote data'}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-500 text-red-500 font-semibold rounded-md hover:bg-red-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-300 disabled:cursor-not-allowed transition-colors dark:text-red-400 dark:border-red-400 dark:hover:bg-red-900/20 dark:disabled:bg-slate-700 dark:disabled:text-slate-500 dark:disabled:border-slate-600"
                  >
                    <TrashIcon className="w-5 h-5" aria-hidden="true" />
                    {isResetting ? 'Resetting...' : 'Reset All Votes'}
                  </button>
              </div>
            </div>

            {viewMode === 'constituency' && selectedConstituency && (
              <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800/50 dark:border dark:border-slate-700 p-6 rounded-xl shadow-md">
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-slate-100">Enter Votes for: <span className="text-blue-600 dark:text-blue-400">{selectedConstituency}</span></h3>
                <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                  {PERMANENT_CANDIDIDATES.map(c => (
                     <div key={c.abbreviation} className="grid grid-cols-2 gap-4 items-center">
                        <label htmlFor={c.abbreviation} className="font-medium text-gray-800 dark:text-slate-200">
                          {c.name}
                          <span className="block text-xs text-gray-500 dark:text-slate-400">{c.party} ({c.abbreviation})</span>
                        </label>
                        <input type="number" min="0" id={c.abbreviation} value={currentVotes[c.abbreviation] || ''} onChange={e => handleVoteChange(c.abbreviation, e.target.value)} className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100" />
                     </div>
                  ))}
                   <div className="grid grid-cols-2 gap-4 items-center border-t border-gray-200 dark:border-slate-700 pt-4 mt-2">
                      <label htmlFor="nullAndVoid" className="font-semibold text-red-600 dark:text-red-500">Null & Void</label>
                      <input 
                        type="number" 
                        min="0" 
                        id="nullAndVoid" 
                        value={currentNullAndVoidVotes || ''} 
                        onChange={e => handleNullAndVoidVotesChange(e.target.value)} 
                        className="w-full p-2 border border-gray-300 rounded-md text-right focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100" 
                      />
                   </div>
                </div>

                {auditInfo && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
                        <InformationCircleIcon className="w-4 h-4 flex-shrink-0" />
                        <p>{auditInfo}</p>
                    </div>
                )}

                <div className="mt-4 flex flex-col sm:flex-row gap-3">
                    <button
                        type="button"
                        onClick={handleResetConstituencyForm}
                        className="w-full px-4 py-3 bg-gray-200 text-gray-800 font-bold rounded-md hover:bg-gray-300 transition-colors flex items-center justify-center order-2 sm:order-1 disabled:opacity-50 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500"
                        disabled={isSubmitting}
                    >
                        Clear Counts
                    </button>
                    <button 
                        type="submit" 
                        disabled={isSubmitting} 
                        className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center justify-center order-1 sm:order-2 dark:disabled:bg-slate-600"
                    >
                        {isSubmitting ? <><LoadingSpinner /> Submitting...</> : 'Submit Results'}
                    </button>
                </div>
              </form>
            )}
          </div>
          
          {/* Right Column: Stats & Graph */}
          <div className={`${isFullscreen ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-6`}>
            <div className="bg-white dark:bg-slate-800/50 dark:border dark:border-slate-700 p-6 rounded-xl shadow-md">
                <div className="flex items-center justify-between mb-4 border-b border-gray-200 dark:border-slate-700 pb-2">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">
                        {viewMode === 'district' ? `District Statistics: ${selectedDistrict || 'N/A'}` : 
                         viewMode === 'national' ? 'National Statistics' : 
                         'Constituency Statistics'}
                    </h2>
                    <div className="flex items-center gap-2">
                        {isLoadingData && <LoadingSpinner />}
                        <button
                            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                            className="p-2 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-800 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                        >
                          {theme === 'light' ? (
                            <MoonIcon className="w-6 h-6" />
                          ) : (
                            <SunIcon className="w-6 h-6" />
                          )}
                        </button>
                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="p-2 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-800 dark:hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen View'}
                            aria-label={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen View'}
                        >
                            {isFullscreen ? (
                                <ExitFullscreenIcon className="w-6 h-6" aria-hidden="true" />
                            ) : (
                                <EnterFullscreenIcon className="w-6 h-6" aria-hidden="true" />
                            )}
                        </button>
                    </div>
                </div>

                {viewMode === 'constituency' && (
                  <>
                    {selectedConstituency ? (
                        <>
                        <div aria-live="polite" className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold dark:text-slate-50">{registeredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold dark:text-slate-50 ${validationError ? 'text-red-500' : ''}`}>{totalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${validationError ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>{turnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {validationError && (
                          <div role="alert" className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-3 dark:bg-red-900/20 dark:border-red-500/30">
                            <WarningIcon className="w-6 h-6 text-red-500 flex-shrink-0" aria-hidden="true" />
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">Warning: Total votes cast exceed the number of registered voters.</p>
                          </div>
                        )}
                        </>
                    ) : (
                        <p className="text-gray-500 dark:text-slate-400 text-center py-8">Select a constituency to view statistics.</p>
                    )}
                  </>
                )}

                {viewMode === 'district' && (
                  <>
                    {selectedDistrict ? (
                        <>
                        <div aria-live="polite" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Reporting</p>
                                <p className="text-3xl font-bold dark:text-slate-50">{districtDisplayData.constituenciesReporting} <span className="text-xl text-gray-500 dark:text-slate-400">/ {districtDisplayData.totalConstituencies}</span></p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold dark:text-slate-50">{districtDisplayData.registeredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold dark:text-slate-50 ${districtDisplayData.validationError ? 'text-red-500' : ''}`}>{districtDisplayData.totalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${districtDisplayData.validationError ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>{districtDisplayData.turnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {districtDisplayData.validationError && (
                          <div role="alert" className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-3 dark:bg-red-900/20 dark:border-red-500/30">
                            <WarningIcon className="w-6 h-6 text-red-500 flex-shrink-0" aria-hidden="true" />
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">Warning: Total district votes cast exceed the number of registered voters.</p>
                          </div>
                        )}
                        </>
                    ) : (
                        <p className="text-gray-500 dark:text-slate-400 text-center py-8">Select a district to view aggregated statistics.</p>
                    )}
                  </>
                )}

                {viewMode === 'national' && (
                    <>
                        <div aria-live="polite" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Reporting</p>
                                <p className="text-3xl font-bold dark:text-slate-50">{nationalDisplayData.constituenciesReporting} <span className="text-xl text-gray-500 dark:text-slate-400">/ {nationalDisplayData.totalConstituencies}</span></p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Registered Voters</p>
                                <p className="text-3xl font-bold dark:text-slate-50">{nationalDisplayData.registeredVoters.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Total Votes Cast</p>
                                <p className={`text-3xl font-bold dark:text-slate-50 ${nationalDisplayData.validationError ? 'text-red-500' : ''}`}>{nationalDisplayData.totalVotesCast.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-500 dark:text-slate-400 text-sm">Voter Turnout</p>
                                <p className={`text-3xl font-bold ${nationalDisplayData.validationError ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>{nationalDisplayData.turnout.toFixed(2)}%</p>
                            </div>
                        </div>
                        {nationalDisplayData.validationError && (
                          <div role="alert" className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-3 dark:bg-red-900/20 dark:border-red-500/30">
                            <WarningIcon className="w-6 h-6 text-red-500 flex-shrink-0" aria-hidden="true" />
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">Warning: Total national votes cast exceed the number of registered voters.</p>
                          </div>
                        )}
                    </>
                )}
            </div>
            <div className="bg-white dark:bg-slate-800/50 dark:border dark:border-slate-700 p-6 rounded-xl shadow-md">
                 <h2 className="text-xl font-bold text-center mb-1 text-gray-900 dark:text-slate-100">
                    Results Breakdown
                 </h2>
                 <p className="text-center text-sm mb-4 text-red-600 dark:text-red-400 font-semibold">Unofficial Results</p>
                 <BarGraph data={barChartData} totalVotes={
                    viewMode === 'district' ? districtDisplayData.totalVotesCast :
                    viewMode === 'national' ? nationalDisplayData.totalVotesCast :
                    totalVotesCast
                 } />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;