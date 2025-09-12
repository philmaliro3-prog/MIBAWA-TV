import React from 'react';

interface BarGraphProps {
    data: { name: string; party: string; value: number; color: string }[];
    totalVotes: number;
}

// Helper function to determine text color based on background luminance for WCAG contrast
const getTextColorForBackground = (hexColor: string): string => {
    try {
        const r = parseInt(hexColor.slice(1, 3), 16);
        const g = parseInt(hexColor.slice(3, 5), 16);
        const b = parseInt(hexColor.slice(5, 7), 16);
        // Formula to calculate luminance
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // Use dark text on light backgrounds and vice-versa
        return luminance > 0.5 ? '#111827' : '#FFFFFF'; // gray-900 or white
    } catch (e) {
        return '#FFFFFF'; // Default to white on error
    }
};


const BarGraph: React.FC<BarGraphProps> = ({ data, totalVotes }) => {
    const sortedData = [...data].sort((a, b) => b.value - a.value);
    
    // Threshold to decide whether to show the label inside or outside the bar
    const LABEL_VISIBILITY_THRESHOLD_PERCENT = 15;

    return (
        <div className="w-full">
            <div className="space-y-3 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
                {sortedData.map((item, index) => {
                    const percentage = totalVotes > 0 ? (item.value / totalVotes) * 100 : 0;
                    const showLabelInside = percentage >= LABEL_VISIBILITY_THRESHOLD_PERCENT;
                    const textColor = getTextColorForBackground(item.color);
                    const accessibleLabel = `${item.name} (${item.party}): ${item.value.toLocaleString()} votes, ${percentage.toFixed(1)}%`;

                    return (
                        <div 
                            key={index} 
                            className="grid grid-cols-6 gap-3 items-center"
                            role="group"
                            aria-label={accessibleLabel}
                        >
                            <span className="col-span-1 text-sm font-medium text-gray-600 dark:text-slate-300 truncate" aria-hidden="true">{item.name}</span>
                            <div className="col-span-4" aria-hidden="true">
                                <div 
                                    className="relative w-full bg-gray-200 dark:bg-slate-700 rounded-full h-6"
                                >
                                    <div
                                        className="h-6 rounded-full text-xs flex items-center justify-end pr-2 font-bold transition-all duration-500 ease-out"
                                        style={{ width: `${percentage}%`, backgroundColor: item.color, color: textColor }}
                                    >
                                      {showLabelInside && item.value > 0 && item.value.toLocaleString()}
                                    </div>
                                    {!showLabelInside && item.value > 0 && (
                                        <span 
                                            className="absolute top-0 h-full flex items-center pl-1 text-xs font-bold text-gray-800 dark:text-slate-100"
                                            style={{ left: `${percentage}%` }}
                                        >
                                            {item.value.toLocaleString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <span className="col-span-1 text-sm font-semibold text-gray-800 dark:text-slate-100 text-right" aria-hidden="true">
                                {percentage.toFixed(1)}%
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700" role="group" aria-label="Chart Legend">
                <h3 className="text-sm font-semibold text-gray-600 dark:text-slate-400 mb-3 text-center" id="legend-heading">Legend</h3>
                <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2" aria-labelledby="legend-heading">
                    {data.map(item => (
                        <li key={item.name} className="flex items-center text-xs">
                            <span className="w-3 h-3 rounded-sm mr-2" style={{ backgroundColor: item.color }} aria-hidden="true"></span>
                            <span className="font-medium text-gray-700 dark:text-slate-300">{item.name}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default BarGraph;