
import { GoogleGenAI } from "@google/genai";
import type { GroundingChunk } from '../types';

if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface ElectionUpdateResult {
    text: string;
    sources: GroundingChunk[];
}

export const fetchElectionUpdates = async (query: string): Promise<ElectionUpdateResult> => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: query,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const text = response.text;
        const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks as GroundingChunk[] || [];
        
        return { text, sources };

    } catch (error) {
        console.error("Error fetching election updates:", error);
        if (error instanceof Error) {
            return {
                text: `An error occurred: ${error.message}`,
                sources: []
            };
        }
        return {
            text: "An unknown error occurred while fetching election updates.",
            sources: []
        };
    }
};
