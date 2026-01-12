import { useState, KeyboardEvent } from "react";

export const useKeyCapture = (onCapture: (key: string) => void, onCancel: () => void) => {
    const [isRecording, setIsRecording] = useState(false);

    const startRecording = () => setIsRecording(true);
    const stopRecording = () => setIsRecording(false);

    const handleKeyDown = (e: KeyboardEvent) => {
        // We allow Tab to escape focus if not actively recording, 
        // but if we are in the input, we capture the next key.
        // For accessibility, keep Tab as a navigation key.
        if (e.key === "Tab") return;

        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") {
            onCancel();
            stopRecording();
            return;
        }

        onCapture(e.key);
        stopRecording();
    };

    return { isRecording, startRecording, stopRecording, handleKeyDown };
};
