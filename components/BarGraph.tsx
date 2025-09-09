import React from 'react';

interface BarGraphProps {
    data: { name: string; party: string; value: number; color: string }[];
    totalVotes: number;
}

const BarGraph: React.FC<BarGraphProps> = ({ data, totalVotes }) => {
    const sortedData = [...data].sort((a, b) => b.value - a.value);
    
    // Threshold to decide whether to show the label inside or outside the bar
    const LABEL_VISIBILITY_THRESHOLD_PERCENT = 15;

    return (
        <div className="w-full">
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                {sortedData.map((item, index) => {
                    const percentage = totalVotes > 0 ? (item.value / totalVotes) * 100 : 0;
                    const showLabelInside = percentage >= LABEL_VISIBILITY_THRESHOLD_PERCENT;

                    return (
                        <div key={index} className="grid grid-cols-6 gap-3 items-center">
                            <span className="col-span-1 text-sm font-medium text-gray-600 truncate">{item.name}</span>
                            <div className="col-span-4">
                                <div 
                                    className="relative w-full bg-gray-200 rounded-full h-6" 
                                    title={`${item.value.toLocaleString()} votes`}
                                >
                                    <div
                                        className="h-6 rounded-full text-white text-xs flex items-center justify-end pr-2 font-bold transition-all duration-500 ease-out"
                                        style={{ width: `${percentage}%`, backgroundColor: item.color }}
                                    >
                                      {showLabelInside && item.value > 0 && item.value.toLocaleString()}
                                    </div>
                                    {!showLabelInside && item.value > 0 && (
                                        <span 
                                            className="absolute top-0 h-full flex items-center pl-1 text-xs font-bold text-gray-700"
                                            style={{ left: `${percentage}%` }}
                                        >
                                            {item.value.toLocaleString()}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <span className="col-span-1 text-sm font-semibold text-gray-800 text-right">
                                {percentage.toFixed(1)}%
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
                <h3 className="text-sm font-semibold text-gray-600 mb-3 text-center">Legend</h3>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                    {data.map(item => (
                        <div key={item.name} className="flex items-center text-xs">
                            <span className="w-3 h-3 rounded-sm mr-2" style={{ backgroundColor: item.color }}></span>
                            <span className="font-medium text-gray-700">{item.name}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BarGraph;