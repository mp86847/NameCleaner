import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, 
  CheckCircle2, 
  Plus, 
  Upload, 
  Download, 
  AlertCircle, 
  ArrowRight,
  Filter,
  Layers,
  Sparkles,
  MousePointer2,
  Save,
  Cloud,
  CloudDownload,
  Loader2
} from 'lucide-react';

// --- Firebase Imports ---
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithCustomToken, 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection 
} from 'firebase/firestore';

// --- Firebase Initialization ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Utility: Fuzzy String Matching (Levenshtein Distance) ---
const getLevenshteinDistance = (a, b) => {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

const getSimilarityScore = (a, b) => {
  const distance = getLevenshteinDistance(a, b);
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1.0 : 1.0 - distance / maxLength;
};

const App = () => {
  // --- State ---
  const [user, setUser] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [rawInputs, setRawInputs] = useState([]);
  const [cleanNames, setCleanNames] = useState([]);
  const [matches, setMatches] = useState({}); // rawIndex: cleanName
  
  // Search & Display State
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  
  const [selectedCleanName, setSelectedCleanName] = useState('');
  const [newCleanInput, setNewCleanInput] = useState('');
  const [threshold, setThreshold] = useState(0.65); // Similarity threshold
  const [displayLimit, setDisplayLimit] = useState(50); // Pagination limit for performance

  // --- Auth & Persistence Effects ---
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Debounce search to improve performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedTerm(searchTerm);
    }, 300); // 300ms delay
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset display limit when search changes
  useEffect(() => {
    setDisplayLimit(50);
  }, [debouncedTerm, threshold]);

  // --- Handlers: File Operations ---
  const handleRawUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const rows = text.split(/\r?\n/).filter(row => row.trim() !== '');
      setRawInputs(rows.map((r, i) => ({ id: i, text: r.trim() })));
    };
    reader.readAsText(file);
  };

  const handleCleanListUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const names = text.split(/\r?\n/).filter(row => row.trim() !== '');
      setCleanNames(prev => [...new Set([...prev, ...names.map(n => n.trim())])]);
    };
    reader.readAsText(file);
  };

  const addCustomCleanName = () => {
    if (newCleanInput && !cleanNames.includes(newCleanInput)) {
      setCleanNames(prev => [...prev, newCleanInput]);
      setSelectedCleanName(newCleanInput);
      setNewCleanInput('');
    }
  };

  const bulkAssign = () => {
    if (!selectedCleanName) return;
    const newMatches = { ...matches };
    // Only assign to the filtered results that are currently relevant
    filteredResults.forEach(item => {
      newMatches[item.id] = selectedCleanName;
    });
    setMatches(newMatches);
  };

  const exportResults = () => {
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Raw Input,Matched Clean Name\n"
      + rawInputs.map(item => `"${item.text}","${matches[item.id] || ''}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "matched_hospitals.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Handlers: Cloud Save/Load ---
  const saveSession = async () => {
    if (!user) return;
    setIsSaving(true);
    setSaveMessage('');
    try {
      const sessionRef = doc(db, 'artifacts', appId, 'users', user.uid, 'hospital_data', 'current_session');
      // Serialize matches object to ensure safe storage if keys are weird, 
      // though Firestore handles objects well.
      await setDoc(sessionRef, {
        rawInputs,
        cleanNames,
        matches,
        lastUpdated: new Date().toISOString()
      });
      setSaveMessage('Saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      console.error("Error saving:", err);
      setSaveMessage('Error saving data.');
    } finally {
      setIsSaving(false);
    }
  };

  const loadSession = async () => {
    if (!user) return;
    setIsLoading(true);
    setSaveMessage('');
    try {
      const sessionRef = doc(db, 'artifacts', appId, 'users', user.uid, 'hospital_data', 'current_session');
      const docSnap = await getDoc(sessionRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.rawInputs) setRawInputs(data.rawInputs);
        if (data.cleanNames) setCleanNames(data.cleanNames);
        if (data.matches) setMatches(data.matches);
        setSaveMessage('Session loaded!');
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage('No saved session found.');
      }
    } catch (err) {
      console.error("Error loading:", err);
      setSaveMessage('Error loading data.');
    } finally {
      setIsLoading(false);
    }
  };

  // --- Logic: Search & Similarity ---
  // Using debouncedTerm instead of searchTerm for heavy calculations
  const filteredResults = useMemo(() => {
    if (!debouncedTerm) return rawInputs;
    
    const term = debouncedTerm.toLowerCase();
    
    // Performance: If input is huge, this map is heavy.
    // We do it once per debounce.
    return rawInputs.map(item => {
      const text = item.text.toLowerCase();
      // Optimization: Check keyword match first. If strict match, skip complex score calc if strict is preferred
      const isKeywordMatch = text.includes(term);
      
      // Calculate score only if needed or if keyword match failed
      const score = getSimilarityScore(term, text);
      
      return { ...item, score, isKeywordMatch };
    }).filter(item => item.isKeywordMatch || item.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }, [rawInputs, debouncedTerm, threshold]);

  // Suggest clean names based on search term
  const suggestedCleanNames = useMemo(() => {
    if (!debouncedTerm) return cleanNames.sort().slice(0, 50); 
    
    const term = debouncedTerm.toLowerCase();
    return cleanNames
      .map(name => ({
        name,
        score: Math.max(
          getSimilarityScore(term, name.toLowerCase()),
          name.toLowerCase().includes(term) ? 0.8 : 0
        )
      }))
      .filter(item => item.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20) // Limit suggestions for performance
      .map(item => item.name);
  }, [cleanNames, debouncedTerm]);

  const progress = rawInputs.length > 0 
    ? (Object.keys(matches).length / rawInputs.length) * 100 
    : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="text-blue-600" /> Hospital Name Matcher
            </h1>
            <p className="text-slate-500 text-sm mt-1">Clean and harmonize raw medical facility inputs.</p>
          </div>
          
          <div className="flex items-center gap-3">
             {/* Cloud Controls */}
            <div className="flex items-center gap-2 mr-4 bg-slate-50 p-1.5 rounded-lg border border-slate-100">
              <button
                onClick={saveSession}
                disabled={isSaving || !user || rawInputs.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-white rounded-md transition-all disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Cloud size={14} />}
                Save Session
              </button>
              <div className="w-px h-4 bg-slate-300"></div>
              <button
                onClick={loadSession}
                disabled={isLoading || !user}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-white rounded-md transition-all disabled:opacity-50"
              >
                {isLoading ? <Loader2 className="animate-spin" size={14} /> : <CloudDownload size={14} />}
                Load Last
              </button>
            </div>
            {saveMessage && <span className="text-xs font-bold text-green-600 animate-pulse">{saveMessage}</span>}

            <button 
              onClick={exportResults}
              disabled={rawInputs.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              <Download size={18} /> Export
            </button>
          </div>
        </header>

        {/* Dashboard Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Inputs</p>
              <p className="text-2xl font-bold">{rawInputs.length}</p>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-full"><Filter size={20} /></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Matched</p>
              <p className="text-2xl font-bold">{Object.keys(matches).length}</p>
            </div>
            <div className="p-3 bg-green-50 text-green-600 rounded-full"><CheckCircle2 size={20} /></div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Completion</p>
            <div className="w-full bg-slate-100 rounded-full h-2.5">
              <div className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="text-right text-xs mt-1 font-medium">{Math.round(progress)}%</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* LEFT COLUMN: Data Sources & Controls */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Upload Section */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="font-semibold mb-4 text-slate-700 flex items-center gap-2">
                <Upload size={18} className="text-blue-500" /> Import Data
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Raw Inputs (CSV)</label>
                  <input type="file" accept=".csv,.txt" onChange={handleRawUpload} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Clean Reference List (TXT/CSV)</label>
                  <input type="file" accept=".csv,.txt" onChange={handleCleanListUpload} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100 cursor-pointer" />
                </div>
              </div>
            </div>

            {/* Assignment Section */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="font-semibold mb-4 text-slate-700 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-green-500" /> Match Actions
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {debouncedTerm ? `Suggestions for "${debouncedTerm}"` : "Master Name List"}
                  </label>
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-1 bg-slate-50 space-y-1">
                    {suggestedCleanNames.length > 0 ? (
                      suggestedCleanNames.map(name => (
                        <button
                          key={name}
                          onClick={() => setSelectedCleanName(name)}
                          className={`w-full text-left px-3 py-2 text-xs rounded-md transition-colors ${selectedCleanName === name ? 'bg-blue-600 text-white shadow-sm' : 'hover:bg-white text-slate-700'}`}
                        >
                          {name}
                        </button>
                      ))
                    ) : (
                      <div className="p-3 text-center text-xs text-slate-400">No matching clean names found</div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Or create new..." 
                    value={newCleanInput}
                    onChange={(e) => setNewCleanInput(e.target.value)}
                    className="flex-1 border border-slate-200 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button onClick={addCustomCleanName} className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">
                    <Plus size={20} />
                  </button>
                </div>

                <button 
                  onClick={bulkAssign}
                  disabled={!selectedCleanName || filteredResults.length === 0}
                  className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2"
                >
                  Match {filteredResults.length} Current Results
                </button>
                {selectedCleanName && (
                  <p className="text-[10px] text-center text-blue-600 font-bold">
                    Target: {selectedCleanName}
                  </p>
                )}
              </div>
            </div>

            {/* Similarity Settings */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h2 className="font-semibold mb-4 text-slate-700 flex items-center gap-2">
                <Sparkles size={18} className="text-purple-500" /> Smart Suggestions
              </h2>
              <label className="block text-xs font-medium text-slate-500 mb-2">Fuzzy Matching Threshold: {Math.round(threshold * 100)}%</label>
              <input 
                type="range" 
                min="0.1" 
                max="0.9" 
                step="0.05" 
                value={threshold} 
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-tighter">
                <span>More results</span>
                <span>Strict accuracy</span>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Search & Results Table */}
          <div className="lg:col-span-8 space-y-4">
            
            {/* Search Bar */}
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
              <input 
                type="text" 
                placeholder="Search keywords or click a hospital name below..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-lg"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 underline"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Results List */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="max-h-[70vh] overflow-y-auto">
                {rawInputs.length === 0 ? (
                  <div className="p-20 text-center text-slate-400">
                    <Upload className="mx-auto mb-4 opacity-20" size={48} />
                    <p>Upload a CSV to begin matching</p>
                  </div>
                ) : (
                  <>
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Raw Input (Click to Search)</th>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Assigned Clean Name</th>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredResults.slice(0, displayLimit).map((item) => {
                          const isMatched = matches[item.id];
                          return (
                            <tr key={item.id} className={`hover:bg-blue-50/40 transition-colors ${isMatched ? 'bg-green-50/10' : ''}`}>
                              <td className="px-6 py-4">
                                <button 
                                  onClick={() => setSearchTerm(item.text)}
                                  className="text-sm font-medium text-slate-700 hover:text-blue-600 flex items-center gap-2 text-left group"
                                >
                                  {item.text}
                                  <MousePointer2 size={14} className="opacity-0 group-hover:opacity-100 text-blue-400" />
                                </button>
                                {!item.isKeywordMatch && debouncedTerm && (
                                  <div className="text-[10px] text-blue-500 font-bold uppercase mt-1">
                                    {Math.round(item.score * 100)}% Match
                                  </div>
                                )}
                              </td>
                              <td className="px-6 py-4 text-center">
                                {isMatched ? (
                                  <CheckCircle2 className="mx-auto text-green-500" size={18} />
                                ) : (
                                  <AlertCircle className="mx-auto text-slate-300" size={18} />
                                )}
                              </td>
                              <td className="px-6 py-4">
                                {isMatched ? (
                                  <span className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-green-200 text-green-700 rounded-full text-xs font-bold shadow-sm">
                                    <ArrowRight size={12} /> {matches[item.id]}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 italic text-xs">Unmatched</span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => {
                                    if (selectedCleanName) {
                                      setMatches(prev => ({ ...prev, [item.id]: selectedCleanName }));
                                    }
                                  }}
                                  disabled={!selectedCleanName}
                                  className="text-blue-600 hover:text-blue-800 font-bold text-xs p-1 rounded hover:bg-blue-100 disabled:opacity-0"
                                >
                                  Match
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredResults.length > displayLimit && (
                      <div className="p-4 text-center border-t border-slate-100">
                        <button 
                          onClick={() => setDisplayLimit(prev => prev + 50)}
                          className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-full transition-colors"
                        >
                          Show 50 more ({filteredResults.length - displayLimit} remaining)
                        </button>
                      </div>
                    )}
                    {filteredResults.length === 0 && (
                      <div className="p-12 text-center text-slate-400 text-sm">
                        No results found for current filters.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
