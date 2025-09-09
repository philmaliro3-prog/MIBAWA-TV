
import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { FlatPollingCenter } from '../types';
import { SearchIcon } from './Icons';

interface SearchProps {
    allPollingCenters: FlatPollingCenter[];
    onSelect: (center: FlatPollingCenter | null) => void;
}

const SearchPollingCenter: React.FC<SearchProps> = ({ allPollingCenters, onSelect }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<FlatPollingCenter[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);

        if (value.length > 2) {
            const lowerCaseValue = value.toLowerCase();
            const filtered = allPollingCenters.filter(pc => 
                pc.name.toLowerCase().includes(lowerCaseValue) || 
                pc.code.includes(lowerCaseValue)
            ).slice(0, 10); // Limit results for performance
            setResults(filtered);
            setIsOpen(true);
        } else {
            setResults([]);
            setIsOpen(false);
        }
    };

    const handleSelect = (center: FlatPollingCenter) => {
        setQuery(`${center.name} (${center.code})`);
        onSelect(center);
        setIsOpen(false);
        setResults([]);
    };

    // Handle clicks outside the search component to close the dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={searchRef}>
            <div className="relative">
                 <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                    <SearchIcon className="w-5 h-5 text-gray-400" />
                </span>
                <input
                    type="text"
                    value={query}
                    onChange={handleSearch}
                    onFocus={() => query.length > 2 && setIsOpen(true)}
                    placeholder="Search Polling Center by name or code..."
                    className="w-full p-2 pl-10 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
            </div>
            {isOpen && results.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {results.map(pc => (
                        <li 
                            key={pc.code} 
                            onClick={() => handleSelect(pc)}
                            className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
                        >
                            <p className="font-semibold">{pc.name} ({pc.code})</p>
                            <p className="text-xs text-gray-500">{`${pc.region} > ${pc.district} > ${pc.constituency}`}</p>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default SearchPollingCenter;
