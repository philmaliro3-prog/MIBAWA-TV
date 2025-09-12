import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Constituency } from '../types';
import { ChevronUpDownIcon } from './Icons';

interface SearchableDropdownProps {
    options: Constituency[];
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
    placeholder: string;
}

const statusStyles: { [key in NonNullable<Constituency['status']>]: { dot: string; text: string } } = {
    'Submitted': { dot: 'bg-green-500', text: 'text-green-700 dark:text-green-400' },
    'In Progress': { dot: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-400' },
    'Not Started': { dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-400' },
};

const SearchableDropdown: React.FC<SearchableDropdownProps> = ({ options, value, onChange, disabled, placeholder }) => {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const filteredOptions = useMemo(() => {
        if (!query) return options;
        const lowerCaseQuery = query.toLowerCase();
        return options.filter(opt => 
            opt.constituency.toLowerCase().includes(lowerCaseQuery)
        );
    }, [query, options]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (option: Constituency) => {
        onChange(option.constituency);
        setQuery('');
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev => (prev + 1) % filteredOptions.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => (prev - 1 + filteredOptions.length) % filteredOptions.length);
                break;
            case 'Enter':
                e.preventDefault();
                if (isOpen && highlightedIndex > -1 && filteredOptions[highlightedIndex]) {
                    handleSelect(filteredOptions[highlightedIndex]);
                }
                break;
            case 'Escape':
                setIsOpen(false);
                break;
            case 'Tab':
                setIsOpen(false);
                break;
        }
    };
    
    useEffect(() => {
        if (isOpen && highlightedIndex >= 0 && listRef.current) {
            const el = listRef.current.children[highlightedIndex] as HTMLLIElement;
            if (el) {
                el.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [highlightedIndex, isOpen]);
    
    useEffect(() => {
        setHighlightedIndex(-1);
    }, [query]);

    const displayValue = value || placeholder;

    return (
        <div ref={containerRef} className="relative">
            <div className="relative">
                 <input
                    ref={inputRef}
                    type="text"
                    value={isOpen ? query : value}
                    onChange={e => {
                        setQuery(e.target.value);
                        if (!isOpen) setIsOpen(true);
                    }}
                    onFocus={() => {
                        setQuery('');
                        setIsOpen(true)
                    }}
                    onBlur={() => {
                        setTimeout(() => { // Delay to allow click to register
                            if (isOpen) setIsOpen(false);
                            setQuery('');
                        }, 150)
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={displayValue}
                    disabled={disabled}
                    aria-autocomplete="list"
                    aria-expanded={isOpen}
                    className="w-full p-2 pr-10 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 dark:disabled:bg-slate-800 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                />
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={disabled}
                    className="absolute inset-y-0 right-0 flex items-center pr-2"
                    aria-label="Toggle dropdown"
                >
                    <ChevronUpDownIcon className="h-5 w-5 text-gray-400" />
                </button>
            </div>
            {isOpen && !disabled && (
                <ul
                    ref={listRef}
                    role="listbox"
                    className="absolute z-20 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto dark:bg-slate-800 dark:border-slate-600"
                >
                    {filteredOptions.length > 0 ? filteredOptions.map((opt, index) => {
                        const statusStyle = opt.status ? statusStyles[opt.status] : statusStyles['Not Started'];
                        return (
                            <li
                                key={opt.id}
                                role="option"
                                aria-selected={highlightedIndex === index}
                                onClick={() => handleSelect(opt)}
                                onMouseOver={() => setHighlightedIndex(index)}
                                className={`px-3 py-2 cursor-pointer flex items-center justify-between ${highlightedIndex === index ? 'bg-blue-100 dark:bg-slate-700' : 'hover:bg-blue-50 dark:hover:bg-slate-700/50'}`}
                            >
                                <span className="font-medium text-gray-900 dark:text-slate-100 truncate">{opt.constituency}</span>
                                {opt.status && (
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                        <span className={`w-2.5 h-2.5 rounded-full ${statusStyle.dot}`} aria-hidden="true"></span>
                                        <span className={`text-xs font-medium ${statusStyle.text}`}>{opt.status}</span>
                                    </div>
                                )}
                            </li>
                        )
                    }) : (
                        <li className="px-3 py-2 text-gray-500 dark:text-slate-400">No results found</li>
                    )}
                </ul>
            )}
        </div>
    );
};

export default SearchableDropdown;
