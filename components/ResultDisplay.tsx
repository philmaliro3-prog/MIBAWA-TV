
import React from 'react';
import type { GroundingChunk } from '../types';

interface ResultDisplayProps {
  result: string;
  sources: GroundingChunk[];
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ result, sources }) => {
  if (!result) return null;

  return (
    <div className="mt-8 w-full bg-slate-800 rounded-lg border border-slate-700 shadow-lg overflow-hidden">
      <div className="p-6">
        <h2 className="text-xl font-bold text-slate-100 mb-4">Response</h2>
        <p className="text-slate-300 whitespace-pre-wrap leading-relaxed">{result}</p>
      </div>
      {sources.length > 0 && (
        <div className="bg-slate-800/50 border-t border-slate-700 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-200 mb-3">Sources from Google Search</h3>
          <ul className="space-y-2">
            {sources.map((source, index) => (
              <li key={index} className="flex items-start gap-3">
                <span className="flex-shrink-0 text-blue-400 mt-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.665l3-3Z" clipRule="evenodd" />
                    <path fillRule="evenodd" d="M8.603 3.799a4 4 0 0 0-5.656 5.656l3 3a4 4 0 0 0 5.656-5.656l-1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a2.5 2.5 0 0 1-3.536-3.536l3-3a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224Z" clipRule="evenodd" />
                  </svg>
                </span>
                <a
                  href={source.web.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 hover:underline break-all transition-colors duration-200"
                  title={source.web.title}
                >
                  {source.web.title || source.web.uri}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ResultDisplay;
