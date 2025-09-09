
import React from 'react';

const Header: React.FC = () => {
    return (
        <header className="w-full bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 p-4 sticky top-0 z-10">
            <div className="max-w-4xl mx-auto flex items-center gap-4">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-8 h-8 text-blue-400"
                >
                    <path
                        fillRule="evenodd"
                        d="M7.5 5.25a3 3 0 0 1 3-3h3a3 3 0 0 1 3 3v.205c.933.085 1.857.197 2.774.334 1.45.221 2.706.663 3.693 1.344a.75.75 0 1 1-.886 1.214c-.819-.595-1.9-1-3.031-1.185A19.5 19.5 0 0 0 12 6.75a19.5 19.5 0 0 0-7.052.812c-1.13.185-2.212.59-3.03 1.185a.75.75 0 1 1-.887-1.214c.987-.68 2.243-1.123 3.693-1.344A41.201 41.201 0 0 1 7.5 5.455V5.25ZM2.25 9.75A.75.75 0 0 1 3 9h18a.75.75 0 0 1 .75.75v10.5A2.25 2.25 0 0 1 19.5 22.5h-15A2.25 2.25 0 0 1 2.25 20.25V9.75Z"
                        clipRule="evenodd"
                    />
                </svg>
                <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
                    Election Pulse
                </h1>
            </div>
        </header>
    );
};

export default Header;
